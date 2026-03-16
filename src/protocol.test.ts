import {expect, test, describe} from 'vitest';
import {toHexAddress, InvalidAddressError} from './protocol.js';

describe('toHexAddress', () => {
  describe('converts', () => {
    test('#1', () => {
      const hex = toHexAddress('TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX');
      expect(hex).to.equal('0x1a6ac17c82ad141ebc524a9ffc94965848f35279');
    });

    test('#2', () => {
      const hex = toHexAddress('TEEFn7rQqx4Xc3GL1Bx27A155xAj7w5W7a');
      expect(hex).to.equal('0x2eb90f8356345c903d9f85e58d1b8177890adfb6');
    });

    test('#3', () => {
      const hex = toHexAddress('TGgd7pXdZALo9GyT4pmF2tT6JRf7ETWVcL');
      expect(hex).to.equal('0x49a5f0cda413ab723fff9baf956329ecfe5d1a23');
    });

    test('#4', () => {
      const hex = toHexAddress('0x6d9f1a927cbcb5e2c28d13ca735bc6d6131406da');
      expect(hex).to.equal('0x6d9F1a927CBcb5e2c28D13CA735bc6d6131406da');
    });

    test('#5 TQEXiCfPcEUVTj7ZtF2iV4UZrcSUKbjVgC', () => {
      const hex = toHexAddress('TQEXiCfPcEUVTj7ZtF2iV4UZrcSUKbjVgC');
      expect(hex.toLowerCase()).to.equal('0x9c779e418100d8b24dddbf36414edb214e513cc9');
    });
  });

  describe('throws', () => {
    test('aptos', () => {
      expect(() =>
        toHexAddress('0x64b543232701efcbd57e7d0296fab57daa61147686e6ebda858e5484976186c5'),
      ).to.throw(InvalidAddressError);
    });

    test('solana', () => {
      expect(() => toHexAddress('Tt4BvRXNxRLY6xJLFLCvieTSG2mL3iokR3o3iiGEuGD')).to.throw(
        InvalidAddressError,
      );
    });

    test('tron#invalid-checksum', () => {
      expect(() => toHexAddress('TGgd7pXdZALo9GyT4pmF2tT6JRf7ETWVc2')).to.throw(
        InvalidAddressError,
      );
    });
  });
});
