import { TextDecoder } from 'util';

export type OTACheckMetadata = Readonly<Record<string, string>>;

// limits shared with the Thinger.io Arduino Library (ThingerOTA THINGER_OTA_CHECK)
export const OTA_CHECK_MAX_FIELDS = 16;
export const OTA_CHECK_MAX_KEY_SIZE = 32;
export const OTA_CHECK_MAX_VALUE_SIZE = 128;
// bytes between the header and the footer: every key\0value\0 pair plus the final empty key
export const OTA_CHECK_MAX_PAYLOAD_SIZE = 1024;

const prefix = Buffer.from('@THINGER_OTA_CHECK:');
const versionOne = Buffer.from('1@\0');
const footer = Buffer.from('@END_THINGER_OTA_CHECK@\0');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Read version 1 metadata from the exact, uncompressed image to be uploaded. */
export function extractOTACheck(image: Uint8Array): OTACheckMetadata | null {
    const buffer = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
    const start = buffer.indexOf(prefix);
    if (start < 0) { return null; }
    if (buffer.indexOf(prefix, start + prefix.length) >= 0) {
        throw new Error('Multiple OTA check manifests found');
    }
    let position = start + prefix.length;
    if (!buffer.subarray(position, position + versionOne.length).equals(versionOne)) {
        throw new Error('Unsupported or invalid OTA check manifest version');
    }
    position += versionOne.length;
    const payloadStart = position;
    const fields: Record<string, string> = Object.create(null);

    const readString = (maxBytes: number): string => {
        const end = buffer.indexOf(0, position);
        if (end < 0 || end - position > maxBytes || end + 1 - payloadStart > OTA_CHECK_MAX_PAYLOAD_SIZE) {
            throw new Error('Truncated or oversized OTA check manifest');
        }
        const value = decoder.decode(buffer.subarray(position, end));
        position = end + 1;
        return value;
    };

    while (true) {
        const key = readString(OTA_CHECK_MAX_KEY_SIZE);
        if (!key) { break; }
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
            throw new Error(`Duplicate OTA check field: ${JSON.stringify(key)}`);
        }
        fields[key] = readString(OTA_CHECK_MAX_VALUE_SIZE);
        if (Object.keys(fields).length > OTA_CHECK_MAX_FIELDS) {
            throw new Error('Too many OTA check fields');
        }
    }
    if (!buffer.subarray(position, position + footer.length).equals(footer)) {
        throw new Error('Invalid OTA check manifest footer');
    }
    return validateOTACheck(fields);
}

/** Keep the fields reported by the device and the compiled manifests under the same bounded schema. */
export function validateOTACheck(value: unknown): OTACheckMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('OTA check must be an object of strings');
    }
    const fields: Record<string, string> = Object.create(null);
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.length > OTA_CHECK_MAX_FIELDS) {
        throw new Error(`OTA check requires 1 to ${OTA_CHECK_MAX_FIELDS} fields`);
    }
    // the final empty key
    let payloadSize = 1;
    for (const key of keys) {
        const field = (value as Record<string, unknown>)[key];
        if (!key || key.includes('\0') || Buffer.byteLength(key) > OTA_CHECK_MAX_KEY_SIZE ||
            typeof field !== 'string' || field.includes('\0') || Buffer.byteLength(field) > OTA_CHECK_MAX_VALUE_SIZE) {
            throw new Error(`Invalid OTA check field: ${JSON.stringify(key)}`);
        }
        payloadSize += Buffer.byteLength(key) + Buffer.byteLength(field) + 2;
        fields[key] = field;
    }
    if (payloadSize > OTA_CHECK_MAX_PAYLOAD_SIZE) {
        throw new Error(`OTA check cannot exceed ${OTA_CHECK_MAX_PAYLOAD_SIZE} bytes`);
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

export enum OTACheckStatus {
    // the device does not report an OTA check: update as usual
    LEGACY = 'LEGACY',
    // the device fields are equal to the candidate firmware manifest
    MATCH = 'MATCH',
    // the device fields differ from the candidate firmware manifest
    MISMATCH = 'MISMATCH',
    // the device reports an OTA check, but the candidate firmware has no manifest
    MISSING = 'MISSING'
}

export interface OTACheckResult {
    status: OTACheckStatus;
    // details to show to the user when confirmation is required
    detail?: string;
}

/**
 * Compare the OTA check reported by the device in $ota/options with the candidate firmware manifest.
 * Throws if the device reports a malformed OTA check.
 */
export function evaluateOTACheck(device: string, reported: unknown, candidate: OTACheckMetadata | null): OTACheckResult {
    // devices without THINGER_OTA_CHECK do not report the field
    if (reported === undefined || reported === null) {
        return { status: OTACheckStatus.LEGACY };
    }

    const current = validateOTACheck(reported);
    const display = (value: string | undefined) => value === undefined ? '<missing>' : JSON.stringify(value);

    if (!candidate) {
        const fields = Object.keys(current).sort().map(key => `${JSON.stringify(key)} = ${display(current[key])}`);
        const detail = [`Device: ${device}`, '', 'Device OTA check:', ...fields, '',
            'The firmware has no OTA check, so it cannot be verified against this device.'].join('\n');
        return { status: OTACheckStatus.MISSING, detail };
    }

    const differences = compareOTACheck(current, candidate);
    if (differences.length === 0) {
        return { status: OTACheckStatus.MATCH };
    }

    const detail = [`Device: ${device}`, '', 'Field: device value -> firmware value',
        ...differences.map(difference => `${JSON.stringify(difference.field)}: ${display(difference.current)} -> ${display(difference.candidate)}`),
        '', 'The firmware may be incompatible with this device.'].join('\n');
    return { status: OTACheckStatus.MISMATCH, detail };
}
