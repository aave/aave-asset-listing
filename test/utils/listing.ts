import { BigNumber } from 'ethers';

export const hex2bin = (hex: string): string => {
  hex = hex.replace('0x', '').toLowerCase();
  let out = '';
  for (const c of hex) {
    switch (c) {
      case '0':
        out += '0000';
        break;
      case '1':
        out += '0001';
        break;
      case '2':
        out += '0010';
        break;
      case '3':
        out += '0011';
        break;
      case '4':
        out += '0100';
        break;
      case '5':
        out += '0101';
        break;
      case '6':
        out += '0110';
        break;
      case '7':
        out += '0111';
        break;
      case '8':
        out += '1000';
        break;
      case '9':
        out += '1001';
        break;
      case 'a':
        out += '1010';
        break;
      case 'b':
        out += '1011';
        break;
      case 'c':
        out += '1100';
        break;
      case 'd':
        out += '1101';
        break;
      case 'e':
        out += '1110';
        break;
      case 'f':
        out += '1111';
        break;
      default:
        return '';
    }
  }

  return out;
};
export const parsePoolData = (data: BigNumber) => {
  const hex = data.toHexString();
  const dataBits = hex2bin(hex);
  const chunkSizes = [16, 16, 16, 8, 1, 1, 1, 1, 4, 16].reverse();
  const chunks = new Array(chunkSizes.length);
  let index = 0;
  for (let i = 0; i < chunkSizes.length; i += 1) {
    const bitChunk = dataBits.substr(index, chunkSizes[i]);
    chunks[i] = parseInt(bitChunk, 2).toString();
    index += chunkSizes[i];
  }
  return {
    reserveFactor: chunks[0] as string,
    reserved: chunks[1] as string,
    stableRateEnabled: chunks[2] as string,
    borrowingEnabled: chunks[3] as string,
    reserveFrozen: chunks[4] as string,
    reserveActive: chunks[5] as string,
    decimals: chunks[6] as string,
    liquidityBonus: chunks[7] as string,
    LiquidityThreshold: chunks[8] as string,
    LTV: chunks[9] as string,
  };
};
