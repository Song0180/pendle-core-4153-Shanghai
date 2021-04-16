import { createFixtureLoader } from "ethereum-waffle";
import { BigNumber as BN, Contract, Wallet } from "ethers";
import ICToken from "../../build/artifacts/contracts/interfaces/ICToken.sol/ICToken.json";
import {
  advanceTime,
  amountToWei,
  approxBigNumber,
  consts,
  emptyToken,
  evm_revert,
  evm_snapshot,
  getCContract,
  getERC20Contract,
  mint,
  mintOtAndXyt,
  Token,
  tokens,
  mintCompoundToken,
} from "../helpers";
import { marketFixture } from "./fixtures";
const hre = require("hardhat");

const { waffle } = require("hardhat");
const { provider } = waffle;

describe("compound-lp-interest", async () => {
  const wallets = provider.getWallets();
  const loadFixture = createFixtureLoader(wallets, provider);
  const [alice, bob, charlie, dave, eve] = wallets;
  let router: Contract;
  let xyt: Contract;
  let ot: Contract;
  let stdMarket: Contract;
  let testToken: Contract;
  let snapshotId: string;
  let globalSnapshotId: string;
  let aaveForge: Contract;
  let aaveV2Forge: Contract;
  let cUSDT: Contract;
  let cUSDTWeb3: any;
  let tokenUSDT: Token;
  const amountUSDTRef = BN.from(10).pow(8);
  let amountXytRef: any;
  const TEST_DELTA = BN.from(2000000);
  const FAKE_INCOME_AMOUNT = consts.INITIAL_COMPOUND_TOKEN_AMOUNT;

  before(async () => {
    globalSnapshotId = await evm_snapshot();

    const fixture = await loadFixture(marketFixture);
    router = fixture.core.router;
    ot = fixture.cForge.cOwnershipToken;
    xyt = fixture.cForge.cFutureYieldToken;
    testToken = fixture.testToken;
    stdMarket = fixture.cMarket;
    tokenUSDT = tokens.USDT;
    aaveForge = fixture.aForge.aaveForge;
    aaveV2Forge = fixture.a2Forge.aaveV2Forge;
    cUSDT = await getCContract(alice, tokenUSDT);
    cUSDTWeb3 = new hre.web3.eth.Contract(ICToken.abi, cUSDT.address);

    for (let user of [alice, bob, charlie, dave, eve]) {
      await emptyToken(ot, user);
      await emptyToken(xyt, user);
      await emptyToken(cUSDT, user);
    }

    await mintOtAndXytUSDT(alice, amountUSDTRef.div(10 ** 6).mul(4));
    amountXytRef = (await xyt.balanceOf(alice.address)).div(4);
    for (let user of [bob, charlie, dave]) {
      await ot.transfer(user.address, amountXytRef);
      await xyt.transfer(user.address, amountXytRef);
    }
    //Note: bob, charlie and dave will not have exactly the same amount of cXYTs

    for (let user of [alice, bob, charlie, dave, eve]) {
      await emptyToken(cUSDT, user);
    }
    snapshotId = await evm_snapshot();
  });

  after(async () => {
    await evm_revert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evm_revert(snapshotId);
    snapshotId = await evm_snapshot();
  });

  async function bootstrapSampleMarket(amount: BN) {
    await router.bootstrapMarket(
      consts.MARKET_FACTORY_COMPOUND,
      xyt.address,
      testToken.address,
      amount,
      (await testToken.balanceOf(alice.address)).div(1000),
      consts.HIGH_GAS_OVERRIDE
    );
  }

  async function addMarketLiquidityDualByXyt(user: Wallet, amountXyt: BN) {
    await router
      .connect(user)
      .addMarketLiquidityDual(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        amountXyt,
        consts.MAX_ALLOWANCE,
        amountXyt,
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function addMarketLiquidityToken(user: Wallet, amount: BN) {
    await router
      .connect(user)
      .addMarketLiquiditySingle(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        false,
        amount,
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function addMarketLiquidityXyt(user: Wallet, amount: BN) {
    await router
      .connect(user)
      .addMarketLiquiditySingle(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        true,
        amount,
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function removeMarketLiquidityDual(user: Wallet, amount: BN) {
    await router
      .connect(user)
      .removeMarketLiquidityDual(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        amount,
        BN.from(0),
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function removeMarketLiquidityXyt(user: Wallet, amount: BN) {
    await router
      .connect(user)
      .removeMarketLiquiditySingle(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        true,
        amount,
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function removeMarketLiquidityToken(user: Wallet, amount: BN) {
    await router
      .connect(user)
      .removeMarketLiquiditySingle(
        consts.MARKET_FACTORY_COMPOUND,
        xyt.address,
        testToken.address,
        false,
        amount,
        BN.from(0),
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function mintOtAndXytUSDT(user: Wallet, amount: BN) {
    await mintOtAndXyt(
      provider,
      tokenUSDT,
      user,
      amount,
      router,
      aaveForge,
      aaveV2Forge
    );
  }

  async function swapExactInXytToToken(user: Wallet, inAmount: BN) {
    await router
      .connect(user)
      .swapExactIn(
        xyt.address,
        testToken.address,
        inAmount,
        BN.from(0),
        consts.MAX_ALLOWANCE,
        consts.MARKET_FACTORY_COMPOUND,
        consts.HIGH_GAS_OVERRIDE
      );
  }

  async function addFakeIncome(token: Token, user: Wallet, amount: BN) {
    await mint(provider, token, user, amount);
    let USDTcontract = await getERC20Contract(user, token);
    USDTcontract.connect(user).transfer(
      cUSDT.address,
      amountToWei(amount, token.decimal)
    );
    await cUSDT.balanceOfUnderlying(user.address); // interact with compound so that it updates all info

    // to have the most accurate result since the interest is only updated every DELTA seconds
  }

  async function checkCUSDTBalance(expectedResult: number[]) {
    for (let id = 0; id < 4; id++) {
      approxBigNumber(
        await cUSDT.balanceOf(wallets[id].address),
        BN.from(expectedResult[id]),
        TEST_DELTA
      );
    }
  }

  async function getLPBalance(user: Wallet) {
    return await stdMarket.balanceOf(user.address);
  }

  it("test 1", async () => {
    await mintOtAndXytUSDT(eve, BN.from(10).pow(5));

    await bootstrapSampleMarket(BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(10));
    await swapExactInXytToToken(eve, BN.from(10).pow(9));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(5));
    await swapExactInXytToToken(eve, BN.from(10).pow(9));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(2));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_MONTH);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(3));
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(6));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_MONTH);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(3));
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(3));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_MONTH);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(2));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_MONTH);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(5));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_DAY);
    for (let user of [alice, bob, charlie, dave]) {
      await router
        .connect(user)
        .claimLpInterests([stdMarket.address], consts.HIGH_GAS_OVERRIDE);
      await router
        .connect(user)
        .redeemDueInterests(
          consts.FORGE_COMPOUND,
          tokenUSDT.address,
          consts.T0_C.add(consts.SIX_MONTH),
          false,
          consts.HIGH_GAS_OVERRIDE
        );
    }

    // for (let user of [alice, bob, charlie, dave]) {
    //   console.log((await cUSDT.balanceOf(user.address)).toString());
    // }
    const expectedResult: number[] = [
      20888931948,
      20987964937,
      21042842354,
      21165667925,
    ];
    await checkCUSDTBalance(expectedResult);
  });

  it("test 2", async () => {
    await mintOtAndXytUSDT(eve, BN.from(10).pow(5));

    await bootstrapSampleMarket(BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addMarketLiquidityXyt(bob, amountXytRef.div(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(9));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(charlie, amountXytRef.div(5));
    await swapExactInXytToToken(eve, BN.from(10).pow(9));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addMarketLiquidityXyt(dave, amountXytRef.div(2));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_MONTH);
    await addMarketLiquidityXyt(dave, amountXytRef.div(3));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(6));

    await advanceTime(provider, consts.ONE_MONTH);
    await addMarketLiquidityXyt(charlie, amountXytRef.div(3));
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(charlie, amountXytRef.div(3));

    await advanceTime(provider, consts.ONE_MONTH);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(2));

    await advanceTime(provider, consts.ONE_MONTH);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(5));

    await advanceTime(provider, consts.ONE_DAY);
    for (let user of [alice, bob, charlie, dave]) {
      await router
        .connect(user)
        .claimLpInterests([stdMarket.address], consts.HIGH_GAS_OVERRIDE);
      await router
        .connect(user)
        .redeemDueInterests(
          consts.FORGE_COMPOUND,
          tokenUSDT.address,
          consts.T0_C.add(consts.SIX_MONTH),
          false,
          consts.HIGH_GAS_OVERRIDE
        );
    }

    // for (let user of [alice, bob, charlie, dave]) {
    //   console.log((await cUSDT.balanceOf(user.address)).toString());
    // }
    const expectedResult: number[] = [
      29550555880,
      26921736683,
      24575771785,
      22951713356,
    ];
    await checkCUSDTBalance(expectedResult);
  });

  it("test 3", async () => {
    await mintOtAndXytUSDT(eve, BN.from(10).pow(5));

    await bootstrapSampleMarket(BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_DAY.mul(5));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await removeMarketLiquidityDual(alice, (await getLPBalance(alice)).div(2));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(10));
    await swapExactInXytToToken(eve, BN.from(10).pow(9));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await removeMarketLiquidityXyt(bob, await getLPBalance(bob));
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(5));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(9));
    await addMarketLiquidityDualByXyt(
      alice,
      await xyt.balanceOf(alice.address)
    );

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(dave, amountXytRef.div(2));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await removeMarketLiquidityToken(
      charlie,
      (await getLPBalance(charlie)).div(3)
    );

    await advanceTime(provider, consts.ONE_MONTH);
    await addMarketLiquidityXyt(dave, amountXytRef.div(3));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(6));

    await advanceTime(provider, consts.ONE_MONTH);
    await removeMarketLiquidityXyt(dave, (await getLPBalance(dave)).div(3));
    await addMarketLiquidityXyt(charlie, amountXytRef.div(3));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(3));

    await advanceTime(provider, consts.ONE_MONTH);
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(2));
    await swapExactInXytToToken(eve, BN.from(10).pow(10));
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityXyt(bob, amountXytRef.div(5));
    await advanceTime(provider, consts.ONE_MONTH);

    await advanceTime(provider, consts.ONE_DAY);
    for (let user of [dave, charlie, bob, alice]) {
      await router
        .connect(user)
        .claimLpInterests([stdMarket.address], consts.HIGH_GAS_OVERRIDE);
      await router
        .connect(user)
        .redeemDueInterests(
          consts.FORGE_COMPOUND,
          tokenUSDT.address,
          consts.T0_C.add(consts.SIX_MONTH),
          false,
          consts.HIGH_GAS_OVERRIDE
        );
    }

    // for (let user of [alice, bob, charlie, dave]) {
    //   console.log((await cUSDT.balanceOf(user.address)).toString());
    // }
    const expectedResult: number[] = [
      45423431397,
      35934848753,
      36069138984,
      34058896615,
    ];
    await checkCUSDTBalance(expectedResult);
  });

  it("test 4", async () => {
    await mintOtAndXytUSDT(eve, BN.from(10).pow(5));

    await bootstrapSampleMarket(BN.from(10).pow(10));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(10));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(5));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(2));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(3));
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(6));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(3));
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(3));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(2));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(5));

    await advanceTime(provider, consts.ONE_DAY);
    for (let user of [alice, bob, charlie, dave]) {
      await router
        .connect(user)
        .claimLpInterests([stdMarket.address], consts.HIGH_GAS_OVERRIDE);
      await router
        .connect(user)
        .redeemDueInterests(
          consts.FORGE_COMPOUND,
          tokenUSDT.address,
          consts.T0_C.add(consts.SIX_MONTH),
          false,
          consts.HIGH_GAS_OVERRIDE
        );
    }

    const aliceCUSDTBalance = await cUSDT.balanceOf(alice.address);
    for (let user of [bob, charlie, dave]) {
      const USDTBalance = await cUSDT.balanceOf(user.address);
      approxBigNumber(USDTBalance, aliceCUSDTBalance, TEST_DELTA);
    }
  });

  it("test 5", async () => {
    await mintOtAndXytUSDT(eve, BN.from(10).pow(5));

    await bootstrapSampleMarket(BN.from(10).pow(10));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(5));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(2));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(3));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(dave, amountXytRef.div(3));
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(5));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(6));
    await addMarketLiquidityDualByXyt(charlie, amountXytRef.div(6));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);
    await addMarketLiquidityDualByXyt(bob, amountXytRef.div(2));

    await advanceTime(provider, consts.FIFTEEN_DAY);
    await addFakeIncome(tokenUSDT, eve, FAKE_INCOME_AMOUNT);

    await advanceTime(provider, consts.ONE_DAY);
    for (let user of [alice, bob, charlie, dave]) {
      await router
        .connect(user)
        .claimLpInterests([stdMarket.address], consts.HIGH_GAS_OVERRIDE);
      await router
        .connect(user)
        .redeemDueInterests(
          consts.FORGE_COMPOUND,
          tokenUSDT.address,
          consts.T0_C.add(consts.SIX_MONTH),
          false,
          consts.HIGH_GAS_OVERRIDE
        );
    }

    const aliceCUSDTBalance = await cUSDT.balanceOf(alice.address);
    for (let user of [bob, charlie, dave]) {
      const USDTBalance = await cUSDT.balanceOf(user.address);
      approxBigNumber(USDTBalance, aliceCUSDTBalance, TEST_DELTA);
    }
  });
});
