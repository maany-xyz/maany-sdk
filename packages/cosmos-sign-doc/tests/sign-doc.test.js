"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const minimal_1 = require("protobufjs/minimal");
const src_1 = require("../src");
const HASH_FIXTURE = '1389e7354f492ce8a18227214920a7eb4b178026f89f3c00fd20f187f4b0b22c';
const EXPECTED_ADDRESS = 'maany1w508d6qejxtdg4y5r3zarvary0c5xw7klu7nmg';
const encodeAny = (any, writer = minimal_1.Writer.create()) => {
    writer.uint32((1 << 3) | 2).string(any.typeUrl);
    writer.uint32((2 << 3) | 2).bytes(any.value);
    return writer.finish();
};
const encodeCoin = (coin, writer = minimal_1.Writer.create()) => {
    writer.uint32((1 << 3) | 2).string(coin.denom);
    writer.uint32((2 << 3) | 2).string(coin.amount);
    return writer.finish();
};
const buildMsgSendAny = (fromAddress, toAddress, amount) => {
    const writer = minimal_1.Writer.create();
    writer.uint32((1 << 3) | 2).string(fromAddress);
    writer.uint32((2 << 3) | 2).string(toAddress);
    amount.forEach((coin) => {
        writer.uint32((3 << 3) | 2).bytes(encodeCoin(coin));
    });
    return {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: writer.finish(),
    };
};
const buildTxBody = (params) => {
    const writer = minimal_1.Writer.create();
    params.messages.forEach((msg) => {
        writer.uint32((1 << 3) | 2).bytes(encodeAny(msg));
    });
    if (params.memo) {
        writer.uint32((2 << 3) | 2).string(params.memo);
    }
    return writer.finish();
};
const buildModeInfoSingle = (writer = minimal_1.Writer.create()) => {
    const singleWriter = minimal_1.Writer.create();
    singleWriter.uint32((1 << 3) | 0).int32(1);
    writer.uint32((1 << 3) | 2).bytes(singleWriter.finish());
    return writer.finish();
};
const buildSignerInfo = (params) => {
    const writer = minimal_1.Writer.create();
    writer.uint32((2 << 3) | 2).bytes(buildModeInfoSingle());
    writer.uint32((3 << 3) | 0).uint64(params.sequence);
    return writer.finish();
};
const buildFee = (params) => {
    const writer = minimal_1.Writer.create();
    params.amount.forEach((coin) => {
        writer.uint32((1 << 3) | 2).bytes(encodeCoin(coin));
    });
    writer.uint32((2 << 3) | 0).uint64(params.gasLimit);
    return writer.finish();
};
const buildAuthInfo = (params) => {
    const writer = minimal_1.Writer.create();
    writer.uint32((1 << 3) | 2).bytes(buildSignerInfo({ sequence: params.sequence }));
    writer.uint32((2 << 3) | 2).bytes(buildFee({ amount: params.feeAmount, gasLimit: params.gasLimit }));
    return writer.finish();
};
(0, vitest_1.describe)('ADR-020 SignDoc', () => {
    (0, vitest_1.it)('matches the fixture digest', () => {
        const msg = buildMsgSendAny(EXPECTED_ADDRESS, 'maany1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe36nh3', [
            { denom: 'uatom', amount: '12345' },
        ]);
        const bodyBytes = buildTxBody({ messages: [msg], memo: 'fixture memo' });
        const authInfoBytes = buildAuthInfo({
            sequence: '7',
            gasLimit: '120000',
            feeAmount: [{ denom: 'uatom', amount: '5000' }],
        });
        const signDoc = (0, src_1.buildSignDoc)({
            bodyBytes,
            authInfoBytes,
            chainId: 'cosmoshub-4',
            accountNumber: '42',
        });
        const digest = (0, src_1.hashSignDoc)(signDoc);
        (0, vitest_1.expect)(Buffer.from(digest).toString('hex')).toBe(HASH_FIXTURE);
    });
});
//# sourceMappingURL=sign-doc.test.js.map