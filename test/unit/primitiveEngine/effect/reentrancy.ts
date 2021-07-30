import { waffle } from 'hardhat'
import { expect } from 'chai'
import { constants, BytesLike } from 'ethers'
import { parseWei } from 'web3-units'

import { reentrancyFragment } from '../fragments'
import loadContext, { DEFAULT_CONFIG as config } from '../../context'
import { computePoolId } from '../../../shared/utils'

const { strike, sigma, maturity, spot } = config
const empty: BytesLike = constants.HashZero
let poolId: string

describe('reentrancy', function () {
  before(async function () {
    loadContext(
      waffle.provider,
      ['reentrancyAttacker', 'engineCreate', 'engineAllocate', 'engineLend', 'engineBorrow'],
      reentrancyFragment
    )
  })

  beforeEach(async function () {
    poolId = computePoolId(this.contracts.factory.address, maturity.raw, sigma.raw, strike.raw)
  })

  describe('when calling create in the create callback', function () {
    it('reverts the transaction', async function () {
      await expect(
        this.contracts.reentrancyAttacker.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
      ).to.be.revertedWith('Locked')
    })
  })

  describe('when calling deposit in the deposit callback', function () {
    beforeEach(async function () {
      await this.contracts.engineCreate.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
    })

    it('reverts the transaction', async function () {
      await expect(
        this.contracts.reentrancyAttacker.deposit(this.signers[0].address, parseWei('1').raw, parseWei('1').raw, empty)
      ).to.be.revertedWith('Locked')
    })
  })

  describe('when calling allocate in the allocate callback', function () {
    beforeEach(async function () {
      await this.contracts.engineCreate.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
    })

    it('reverts the transaction', async function () {
      await expect(
        this.contracts.reentrancyAttacker.allocate(poolId, this.signers[0].address, parseWei('1').raw, empty)
      ).to.be.revertedWith('Locked')
    })
  })

  describe('when calling remove in the remove callback', function () {
    beforeEach(async function () {
      await this.contracts.engineCreate.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
      await this.contracts.engineAllocate.allocateFromExternal(
        poolId,
        this.contracts.reentrancyAttacker.address,
        parseWei('10').raw,
        empty
      )
    })

    it('reverts the transaction', async function () {
      await expect(this.contracts.reentrancyAttacker.remove(poolId, parseWei('1').raw, empty)).to.be.revertedWith('Locked')
    })
  })

  describe('when calling borrow in the borrow callback', function () {
    beforeEach(async function () {
      await this.contracts.engineCreate.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
      await this.contracts.engineAllocate.allocateFromExternal(
        poolId,
        this.contracts.engineLend.address,
        parseWei('100').raw,
        empty
      )
      await this.contracts.engineLend.lend(poolId, parseWei('100').raw)
    })

    it('reverts the transaction', async function () {
      await expect(
        this.contracts.reentrancyAttacker.borrow(poolId, this.signers[0].address, parseWei('1').raw, empty)
      ).to.be.revertedWith('Locked')
    })
  })

  describe('when calling repay in the repay callback', function () {
    beforeEach(async function () {
      await this.contracts.engineCreate.create(strike.raw, sigma.raw, maturity.raw, spot.raw, parseWei('1').raw, empty)
      await this.contracts.engineAllocate.allocateFromExternal(
        poolId,
        this.contracts.engineLend.address,
        parseWei('100').raw,
        empty
      )
      await this.contracts.engineLend.lend(poolId, parseWei('100').raw)
      await this.contracts.reentrancyAttacker.borrowWithGoodCallback(
        poolId,
        this.contracts.reentrancyAttacker.address,
        parseWei('1').raw,
        empty
      )
    })

    it('reverts the transaction', async function () {
      await expect(
        this.contracts.reentrancyAttacker.repay(
          poolId,
          this.contracts.reentrancyAttacker.address,
          parseWei('1').raw,
          false,
          empty
        )
      ).to.be.revertedWith('Locked')
    })
  })
})
