// SPDX-License-Identifier: MIT
/*
 * MIT License
 * ===========
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 */
pragma solidity 0.7.6;
pragma experimental ABIEncoderV2;

import "../../interfaces/IPendleAaveForge.sol";
import "../../libraries/MathLib.sol";
import "./../abstract/PendleMarketBase.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract PendleAaveMarket is PendleMarketBase {
    using Math for uint256;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // the normalisedIncome of the last time paramL got updated
    uint256 private globalLastNormalizedIncome;
    mapping(address => uint256) private userLastNormalizedIncome;

    constructor(
        address _governanceManager,
        address _xyt,
        address _token
    ) PendleMarketBase(_governanceManager, _xyt, _token) {}

    function _getReserveNormalizedIncome() internal view returns (uint256) {
        return IPendleAaveForge(forge).getReserveNormalizedIncome(underlyingAsset);
    }

    function _afterBootstrap() internal override {
        globalLastNormalizedIncome = _getReserveNormalizedIncome();
    }

    /// @inheritdoc PendleMarketBase
    function _updateDueInterests(address user) internal override {
        // before calc the interest for users, updateParamL
        _updateParamL();

        uint256 lastIncome = userLastNormalizedIncome[user];
        // why use globalLastNormalizedIncome? Because of the caching of paramL, we pretend that there is no source
        // of income externally (from Xyt, compound interest...), that's why we have to use globalLastNormalizedIncome
        // , which is the normalisedIncome from the last time paramL got updated (aka the last time we get external income)
        uint256 normIncomeNow = globalLastNormalizedIncome;
        uint256 principal = balanceOf(user);

        if (lastIncome == 0) {
            userLastNormalizedIncome[user] = normIncomeNow;
            lastParamL[user] = paramL;
            return;
        }

        /*
        this part can be thought of as follows:
            * the last time the user redeems interest, the value of a LP is lastParamL[user]
                and he has redeemed all the available interest out
            * the market has 2 sources of income: compound interest of the yieldTokens in the market right now
            AND external income (XYT interest, people transferring wrongly...)
            * now the value of param L is paramL. So there has been an increase of paramL - lastParamL[user]
                in value of a single LP. But in Aave, even if there are no external income, the value of a paramL
                can grow on its own
            * so since the last time the user has fully redeemed all the available interest, he shouldn't receive
            the compound interest sof the asset in the pool at the moment he last withdrew
            * so the value of 1 LP for him will be paramL - compound(lastParamL[user])
                = paramL -  lastParamL[user] * globalLastNormalizedIncome /userLastNormalizedIncome[user]
        */
        uint256 interestValuePerLP =
            paramL.subMax0(lastParamL[user].mul(normIncomeNow).div(lastIncome));

        uint256 interestFromLp = principal.mul(interestValuePerLP).div(MULTIPLIER);

        dueInterests[user] = dueInterests[user].mul(normIncomeNow).div(lastIncome).add(
            interestFromLp
        );

        userLastNormalizedIncome[user] = normIncomeNow;
        lastParamL[user] = paramL;
    }

    /// @inheritdoc PendleMarketBase
    function _getFirstTermAndParamR(uint256 currentNYield)
        internal
        override
        returns (uint256 firstTerm, uint256 paramR)
    {
        uint256 currentNormalizedIncome = _getReserveNormalizedIncome();
        // for Aave, the paramL can grow on its own (compound effect)
        firstTerm = paramL.mul(currentNormalizedIncome).div(globalLastNormalizedIncome);

        uint256 ix = lastNYield.mul(currentNormalizedIncome).div(globalLastNormalizedIncome);
        // paramR's meaning has been explained in the updateParamL function
        paramR = currentNYield.subMax0(ix);

        globalLastNormalizedIncome = currentNormalizedIncome;
    }

    /// @inheritdoc PendleMarketBase
    function _getIncomeIndexIncreaseRate() internal view override returns (uint256 increaseRate) {
        return _getReserveNormalizedIncome().rdiv(globalLastNormalizedIncome) - Math.RONE;
    }
}
