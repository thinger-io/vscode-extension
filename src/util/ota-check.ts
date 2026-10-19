import { TextDecoder } from 'util';

export type OTACheckMetadata = Readonly<Record<string, string>>;

const prefix = Buffer.from('@THINGER_OTA_CHECK:');
const versionOne = Buffer.from('1@\0');
const footer = Buffer.from('@END_THINGER_OTA_CHECK@\0');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const maxPayloadSize = 4096;

/** Read version 1 metadata from the exact, uncompressed image to be uploaded. */
export function extractOTACheck(image: Uint8Array): OTACheckMetadata | null {
    const buffer = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
    const start = buffer.indexOf(prefix);
    if (start < 0) { return null; }
    if (buffer.indexOf(prefix, start + prefix.length) >= 0) {
        throw new Error('Multiple OTA compatibility manifests found');
    }
    let position = start + prefix.length;
    if (!buffer.subarray(position, position + versionOne.length).equals(versionOne)) {
        throw new Error('Unsupported or invalid OTA compatibility manifest version');
    }
    position += versionOne.length;
    const payloadStart = position;
    const fields: Record<string, string> = Object.create(null);

    const readString = (maxBytes: number): string => {
        const end = buffer.indexOf(0, position);
        if (end < 0 || end - position > maxBytes || end + 1 - payloadStart > maxPayloadSize) {
            throw new Error('Truncated or oversized OTA compatibility manifest');
        }
        const value = decoder.decode(buffer.subarray(position, end));
        position = end + 1;
        return value;
    };

    while (true) {
        const key = readString(64);
        if (!key) { break; }
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
            throw new Error(`Duplicate OTA compatibility field: ${JSON.stringify(key)}`);
        }
        fields[key] = readString(256);
        if (Object.keys(fields).length > 32) {
            throw new Error('Too many OTA compatibility fields');
        }
    }
    if (!buffer.subarray(position, position + footer.length).equals(footer)) {
        throw new Error('Invalid OTA compatibility manifest footer');
    }
    return validateOTACheck(fields);
}

/** Keep device resources and compiled manifests under the same bounded schema. */
export function validateOTACheck(value: unknown): OTACheckMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('OTA compatibility metadata must be an object of strings');
    }
    const fields: Record<string, string> = Object.create(null);
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.length > 32) {
        throw new Error('OTA compatibility metadata requires 1 to 32 fields');
    }
    let payloadSize = 1;
    for (const key of keys) {
        const field = (value as Record<string, unknown>)[key];
        if (!key || key.includes('\0') || Buffer.byteLength(key) > 64 ||
            typeof field !== 'string' || field.includes('\0') || Buffer.byteLength(field) > 256) {
            throw new Error(`Invalid OTA compatibility field: ${JSON.stringify(key)}`);
        }
        payloadSize += Buffer.byteLength(key) + Buffer.byteLength(field) + 2;
        fields[key] = field;
    }
    if (payloadSize > maxPayloadSize) {
        throw new Error('OTA compatibility payload cannot exceed 4096 bytes');
    }
    return Object.freeze(fields);
}

export interface OTACheckDifference {
    field: string;
    current: string | undefined;
    candidate: string | undefined;
}

export function compareOTACheck(current: OTACheckMetadata, candidate: OTACheckMetadata): OTACheckDifference[] {
    const own = (metadata: OTACheckMetadata, field: string) =>
        Object.prototype.hasOwnProperty.call(metadata, field) ? metadata[field] : undefined;
    return Array.from(new Set([...Object.keys(current), ...Object.keys(candidate)]))
        .sort()
        .filter(field => own(current, field) !== own(candidate, field))
        .map(field => ({ field, current: own(current, field), candidate: own(candidate, field) }));
}

export interface OTACheckDecision {
    proceed: boolean;
    matches: boolean;
}

/** Confirmation is supplied by the caller so no upload can begin before it resolves. */
export async function confirmOTACheck(
    device: string,
    current: OTACheckMetadata | null,
    candidate: OTACheckMetadata | null,
    confirm: (message: string, detail: string) => Promise<boolean>
): Promise<OTACheckDecision> {
    const display = (value: string | undefined) => value === undefined ? '<missing>' : JSON.stringify(value);
    if (current && candidate) {
        const differences = compareOTACheck(current, candidate);
        if (differences.length === 0) { return { proceed: true, matches: true }; }
        const detail = [`Device: ${device}`, '', 'Field: device value -> candidate firmware value',
            ...differences.map(difference => `${JSON.stringify(difference.field)}: ${display(difference.current)} -> ${display(difference.candidate)}`),
            '', 'The firmware may be incompatible with this device. Continue with this device?'].join('\n');
        return { proceed: await confirm('OTA compatibility fields do not match.', detail), matches: false };
    }

    const describe = (metadata: OTACheckMetadata | null): string => metadata
        ? Object.keys(metadata).sort().map(key => `${JSON.stringify(key)} = ${display(metadata[key])}`).join('\n')
        : 'THINGER_OTA_CHECK metadata is missing.';
    const detail = [`Device: ${device}`, '', 'Current device:', describe(current), '',
        'Candidate firmware:', describe(candidate), '',
        'Compatibility cannot be verified. Continue with this device without verification?'].join('\n');
    return { proceed: await confirm('OTA compatibility cannot be verified.', detail), matches: false };
}
