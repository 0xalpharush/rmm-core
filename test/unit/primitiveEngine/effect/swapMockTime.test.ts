import expect from '../../../shared/expect'
import hre from 'hardhat'
import { constants, Wallet, BigNumber, Contract } from 'ethers'
import { Wei, parseWei, Time, parsePercentage } from 'web3-units'

import { MockEngine, TestRouter } from '../../../../typechain'
import { Calibration } from '../../../shared'
import { testContext } from '../../../shared/testContext'
import { PrimitiveFixture, primitiveFixture } from '../../../shared/fixtures'
import { useTokens, useApproveAll, usePool } from '../../../shared/hooks'
import { Pool } from '../../../shared'
import { TestPools, PoolState } from '../../../shared/poolConfigs'
import { scaleUp } from '../../../shared'
import { callDelta } from '@primitivefinance/v2-math'

const { HashZero, MaxUint256 } = constants
const YEAR = Time.YearInSeconds

async function logRes(engine: Contract, poolId: string, decimalsRisky = 18, decimalsStable = 18) {
  const res = await engine.reserves(poolId)
  const obj = {
    risky: new Wei(res.reserveRisky, decimalsRisky),
    stable: new Wei(res.reserveStable, decimalsStable),
    liquidity: new Wei(res.liquidity),
  }

  if (DEBUG) {
    console.log(`       - Risky: ${obj.risky.float}`)
    console.log(`       - Stable: ${obj.stable.float}`)
  }
  return obj
}

const timeTests = {
  min: 1,
  max: YEAR,
  increment: YEAR * 0.25,
}

interface Reserves {
  risky: Wei
  stable: Wei
  liquidity: Wei
}

const DEBUG = true

TestPools.forEach(function (pool: PoolState) {
  testContext(`mocking time for ${pool.description}`, function () {
    let poolId: string, deployer: Wallet, engine: MockEngine, router: TestRouter
    const {
      strike,
      sigma,
      maturity,
      lastTimestamp,
      fee,
      spot,
      decimalsRisky,
      decimalsStable,
      scaleFactorRisky,
      scaleFactorStable,
    } = pool.calibration

    beforeEach(async function () {
      const poolFixture = async ([wallet]: Wallet[], provider: any): Promise<PrimitiveFixture> => {
        let fix = await primitiveFixture([wallet], provider)
        // if using a custom engine, create it and replace the default contracts

        const { risky, stable, engine } = await fix.createEngine(decimalsRisky, decimalsStable)

        fix.contracts.risky = risky
        fix.contracts.stable = stable
        fix.contracts.engine = engine
        await fix.contracts.router.setEngine(engine.address) // set the router's engine

        return fix
      }

      const fixture = await this.loadFixture(poolFixture)
      this.contracts = fixture.contracts
      ;[deployer, engine, router] = [this.signers[0], this.contracts.engine, this.contracts.router] // contracts

      await useTokens(deployer, this.contracts, pool.calibration)
      await useApproveAll(deployer, this.contracts)
      ;({ poolId } = await usePool(deployer, this.contracts, pool.calibration))
    })

    for (let i = timeTests.min; i < timeTests.max; i += timeTests.increment) {
      it(`successfully swaps 0.5 tokens after ${Math.floor(i)} seconds have passed`, async function () {
        // advances time
        await engine.advanceTime(Math.floor(i))
        // get the reserves
        let res = await logRes(this.contracts.engine, poolId, decimalsRisky, decimalsStable)
        // does the swap
        let amount = scaleUp(0.5, decimalsRisky)

        // swap stable -> risky
        let tx = await router.swap(poolId, false, amount.raw, false, false, HashZero)
        await expect(tx).to.increaseInvariant(engine, poolId)

        // calculate amount out
        const amountOut = res.risky.sub((await this.contracts.engine.reserves(poolId)).reserveRisky)

        // swap risky -> stable
        tx = await router.swap(poolId, true, amountOut.raw, false, false, HashZero)
        await expect(tx).to.increaseInvariant(engine, poolId)
      })
      for (let a = 1; a < strike.float; a++) {
        it(`swaps ${a} stable to risky after ${Math.floor(i)} seconds have passed`, async function () {
          // advances time
          await engine.advanceTime(Math.floor(i))
          await engine.updateLastTimestamp(poolId)
          let delta = scaleUp(
            callDelta(strike.float, sigma.float, maturity.sub(new Time(Math.floor(i) - 1)).years, spot.float),
            decimalsRisky
          )
          await this.contracts.risky.approve(engine.address, MaxUint256)
          await this.contracts.stable.approve(engine.address, MaxUint256)
          await engine.updateReserves(poolId, scaleUp(1, decimalsRisky).sub(delta).raw)
          // get the reserves
          let res = await logRes(this.contracts.engine, poolId, decimalsRisky, decimalsStable)
          const maxInStable = strike.sub(res.stable)
          // does the swap
          let amount = scaleUp(a, decimalsStable)

          if (amount.gt(maxInStable)) amount = maxInStable.sub(await engine.MIN_LIQUIDITY())

          // swap stable -> risky
          let tx = router.swap(poolId, false, amount.raw, false, false, HashZero)
          await expect(tx).to.increaseInvariant(engine, poolId)
        })
      }

      // TODO: FIX THIS
      /* for (let a = 0.1; a < 1; a += 0.1) {
        it(`swaps ${a} risky to stable tokens after ${Math.floor(i)} seconds have passed`, async function () {
          // advances time
          await engine.advanceTime(Math.floor(i))
          await engine.updateLastTimestamp(poolId)
          let delta = scaleUp(
            callDelta(strike.float, sigma.float, maturity.sub(new Time(Math.floor(i) - 1)).years, spot.float),
            decimalsRisky
          )
          await this.contracts.risky.approve(engine.address, MaxUint256)
          await this.contracts.stable.approve(engine.address, MaxUint256)
          await engine.updateReserves(poolId, scaleUp(1, decimalsRisky).sub(delta).raw)
          // get the reserves
          let res = await logRes(this.contracts.engine, poolId, decimalsRisky, decimalsStable)
          const maxInRisky = delta.sub(await engine.MIN_LIQUIDITY())
          // does the swap
          let amount = scaleUp(a, decimalsRisky)

          if (amount.gt(maxInRisky)) amount = maxInRisky

          // swap risky -> stable
          console.log(
            'swapping risky now',
            amount.toString(),
            (await this.contracts.risky.balanceOf(engine.address)).toString(),
            (await this.contracts.stable.balanceOf(engine.address)).toString()
          )
          let tx = router.swap(poolId, true, amount.raw, false, false, HashZero)
          await expect(tx).to.increaseInvariant(engine, poolId)
        })
      } */
    }
  })
})
