import * as fs from 'fs';

const EI = 11; // typically 10..13
const EJ = 4;  // typically 4..5
const P = 1;   // If match length <= P then output one character
const N = 1 << EI;  // buffer size
const F = (1 << EJ) + 1;  // lookahead buffer size

export class LZSS {
  private bitBuffer: number = 0;
  private bitMask: number = 128;
  private codeCount: number = 0;
  private textCount: number = 0;
  private buffer: Buffer = Buffer.alloc(N * 2);

  constructor() {

  }

  private reset(): void {
    this.bitBuffer = 0;
    this.bitMask = 128;
    this.codeCount = 0;
    this.textCount = 0;
    this.buffer = Buffer.alloc(N * 2);
  }

  private putbit1(output: number[]): void {
    this.bitBuffer |= this.bitMask;
    if ((this.bitMask >>= 1) === 0) {
      output.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitMask = 128;
      this.codeCount++;
    }
  }

  private putbit0(output: number[]): void {
    if ((this.bitMask >>= 1) === 0) {
      output.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitMask = 128;
      this.codeCount++;
    }
  }

  private flushBitBuffer(output: number[]): void {
    if (this.bitMask !== 128) {
      output.push(this.bitBuffer);
      this.codeCount++;
    }
  }

  private output1(c: number, output: number[]): void {
    this.putbit1(output);
    for (let mask = 256; mask >>= 1;) {
      if (c & mask) {this.putbit1(output);}
      else {this.putbit0(output);}
    }
  }

  private output2(x: number, y: number, output: number[]): void {
    this.putbit0(output);
    for (let mask = N; mask >>= 1;) {
      if (x & mask) {this.putbit1(output);}
      else {this.putbit0(output);}
    }
    for (let mask = 1 << EJ; mask >>= 1;) {
      if (y & mask) {this.putbit1(output);}
      else {this.putbit0(output);}
    }
  }

  public encode(input: Buffer): Buffer {
    this.reset();
    let r: number, s: number, bufferend: number;
    let output: number[] = [];
    let i: number, j: number, f1: number, x: number, y: number, c: number;

    this.buffer.fill(' '.charCodeAt(0), 0, N - F);

    for (i = N - F; i < N * 2; i++) {
      if (i - (N - F) >= input.length) {break;}
      this.buffer[i] = input[i - (N - F)];
      this.textCount++;
    }
    bufferend = i;
    r = N - F;
    s = 0;
    while (r < bufferend) {
      f1 = (F <= bufferend - r) ? F : bufferend - r;
      x = 0;
      y = 1;
      c = this.buffer[r];
      for (i = r - 1; i >= s; i--) {
        if (this.buffer[i] === c) {
          for (j = 1; j < f1; j++) {
            if (this.buffer[i + j] !== this.buffer[r + j]) {break;}
          }
          if (j > y) {
            x = i;
            y = j;
          }
        }
      }
      if (y <= P) {
        y = 1;
        this.output1(c, output);
      } else {
        this.output2(x & (N - 1), y - 2, output);
      }
      r += y;
      s += y;
      if (r >= N * 2 - F) {
        this.buffer.copy(this.buffer, 0, N, N * 2);
        bufferend -= N;
        r -= N;
        s -= N;
        while (bufferend < N * 2) {
          if (this.textCount >= input.length) {break;}
          this.buffer[bufferend++] = input[this.textCount++];
        }
      }
    }
    this.flushBitBuffer(output);
    return Buffer.from(output);
  }

  private getbit(n: number, input: Buffer): number {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (this.bitMask === 0) {
        if (this.textCount >= input.length) {return -1;}
        this.bitBuffer = input[this.textCount++];
        this.bitMask = 128;
      }
      x = (x << 1) | ((this.bitBuffer & this.bitMask) ? 1 : 0);
      this.bitMask >>= 1;
    }
    return x;
  }

  public decode(input: Buffer): Buffer {
    this.reset();
    let r: number, c: number;
    let output: number[] = [];
    let i: number, j: number, k: number;

    this.buffer.fill(' '.charCodeAt(0), 0, N - F);
    r = N - F;
    this.bitMask = 0;  // reset bit mask to start reading new bytes

    while ((c = this.getbit(1, input)) !== -1) {
      if (c) {
        if ((c = this.getbit(8, input)) === -1) {break;}
        output.push(c);
        this.buffer[r++] = c;
        r &= (N - 1);
      } else {
        if ((i = this.getbit(EI, input)) === -1) {break;}
        if ((j = this.getbit(EJ, input)) === -1) {break;}
        for (k = 0; k <= j + 1; k++) {
          c = this.buffer[(i + k) & (N - 1)];
          output.push(c);
          this.buffer[r++] = c;
          r &= (N - 1);
        }
      }
    }
    return Buffer.from(output);
  }

  public compressFile(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.readFile(inputPath, (err, data) => {
        if (err) {
          return reject('Error reading input file: ' + err);
        }
        const compressedData = this.encode(data);
        fs.writeFile(outputPath, compressedData, (err) => {
          if (err) {
            return reject('Error writing compressed file: ' + err);
          }
          console.log('File compressed successfully');
          resolve();
        });
      });
    });
  }

  public decompressFile(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.readFile(inputPath, (err, data) => {
        if (err) {
          return reject('Error reading input file: ' + err);
        }
        const decompressedData = this.decode(data);
        fs.writeFile(outputPath, decompressedData, (err) => {
          if (err) {
            return reject('Error writing decompressed file: ' + err);
          }
          console.log('File decompressed successfully');
          resolve();
        });
      });
    });
  }
}