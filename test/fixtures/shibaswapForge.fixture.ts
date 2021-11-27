import { Contract, providers, Wallet } from 'ethers';
import PendleShibaswapForge from '../../build/artifacts/contracts/core/shibaswap/PendleshibaswapForge.sol/PendleshibaswapForge.json';
import PendleYieldContractDeployerBaseV2 from '../../build/artifacts/contracts/core/abstractV2/PendleYieldContractDeployerBaseV2.sol/PendleYieldContractDeployerBaseV2.json';
import MockPendleOwnershipToken from '../../build/artifacts/contracts/mock/MockPendleOwnershipToken.sol/MockPendleOwnershipToken.json';
import PendleFutureYieldToken from '../../build/artifacts/contracts/tokens/PendleFutureYieldToken.sol/PendleFutureYieldToken.json';
import MockPendleRewardManager from '../../build/artifacts/contracts/mock/MockPendleRewardManager.sol/MockPendleRewardManager.json';
import { consts, setTimeNextBlock, tokens } from '../helpers';
import { CoreFixture } from './core.fixture';
import { GovernanceFixture } from './governance.fixture';

const { waffle } = require('hardhat');
const { deployContract } = waffle;

export interface ShibaswapForgeFixture {
  shibaswapForge: Contract;
  sbOwnershipToken: Contract;
  sbFutureYieldToken: Contract;
  sbRewardManager: Contract;
}

export async function shibaswapForgeFixture(
  alice: Wallet,
  provider: providers.Web3Provider,
  { router, data, govManager }: CoreFixture,
  { pendle }: GovernanceFixture
): Promise<ShibaswapForgeFixture> {
  const sbRewardManager = await deployContract(alice, MockPendleRewardManager, [
    govManager.address,
    consts.FORGE_SHIBASWAP,
  ]);

  const ssYieldContractDeployer = await deployContract(alice, PendleYieldContractDeployerBaseV2, [
    govManager.address,
    consts.FORGE_SHIBASWAP,
  ]);

  const shibaswapForge = await deployContract(alice, PendleShibaswapForge, [
    govManager.address,
    router.address,
    consts.FORGE_SHIBASWAP,
    tokens.USDT.address,
    sbRewardManager.address,
    ssYieldContractDeployer.address,
    consts.CODE_HASH_SHIBASWAP,
    consts.FACTORY_SHIBASWAP,
  ]);

  await sbRewardManager.setSkippingRewards(true, consts.HG);

  await sbRewardManager.initialize(shibaswapForge.address);
  await ssYieldContractDeployer.initialize(shibaswapForge.address);
  await data.addForge(consts.FORGE_SHIBASWAP, shibaswapForge.address, consts.HG);

  await shibaswapForge.registerTokens(
    [tokens.SHIBA_USDT_WETH_LP.address],
    [[tokens.SHIBA_USDT_WETH_LP.address]],
    consts.HG
  );
  await setTimeNextBlock(consts.T0_SS);

  await router.newYieldContracts(
    consts.FORGE_SHIBASWAP,
    tokens.SHIBA_USDT_WETH_LP.address,
    consts.T0_SS.add(consts.SIX_MONTH),
    consts.HG
  );

  const otTokenAddress = await data.otTokens(
    consts.FORGE_SHIBASWAP,
    tokens.SHIBA_USDT_WETH_LP.address,
    consts.T0_SS.add(consts.SIX_MONTH)
  );

  const xytTokenAddress = await data.xytTokens(
    consts.FORGE_SHIBASWAP,
    tokens.SHIBA_USDT_WETH_LP.address,
    consts.T0_SS.add(consts.SIX_MONTH)
  );

  const sbOwnershipToken = new Contract(otTokenAddress, MockPendleOwnershipToken.abi, alice);
  const sbFutureYieldToken = new Contract(xytTokenAddress, PendleFutureYieldToken.abi, alice);

  return {
    shibaswapForge,
    sbOwnershipToken,
    sbFutureYieldToken,
    sbRewardManager,
  };
}
