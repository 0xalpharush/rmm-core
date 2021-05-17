import { Wei, toBN, formatEther, parseEther, parseWei, fromInt, BigNumber, fromMantissa } from './Units'
import { constants, Contract, Wallet, Transaction, BytesLike, BigNumberish } from 'ethers'
import { getTradingFunction, getInverseTradingFunction } from './ReplicationMath'
import { IERC20, TestCallee, TestEngine } from '../../typechain'

export const ERC20Events = {
  EXCEEDS_BALANCE: 'ERC20: transfer amount exceeds balance',
}

export const EngineEvents = {
  DEPOSITED: 'Deposited',
  WITHDRAWN: 'Withdrawn',
  CREATE: 'Create',
  UPDATE: 'Update',
  ADDED_BOTH: 'AddedBoth',
  REMOVED_BOTH: 'RemovedBoth',
  SWAP: 'Swap',
  LOANED: 'Loaned',
  CLAIMED: 'Claimed',
  BORROWED: 'Borrowed',
  REPAID: 'Repaid',
}

export type DepositFunction = (deltaX: BigNumberish, deltaY: BigNumberish) => Promise<Transaction>
export type WithdrawFunction = (deltaX: BigNumberish, deltaY: BigNumberish) => Promise<Transaction>
export type AddLiquidityFunction = (pid: BytesLike, nonce: BigNumberish, deltaL: BigNumberish) => Promise<Transaction>
export type SwapFunction = (pid: BytesLike, deltaOut: BigNumberish, deltaInMax: BigNumberish) => Promise<Transaction>
export type CreateFunction = (calibration: Calibration, spot: BigNumberish) => Promise<Transaction>
export type LendFunction = (pid: BytesLike, nonce: BigNumberish, deltaL: BigNumberish) => Promise<Transaction>
export type ClaimFunction = (pid: BytesLike, nonce: BigNumberish, deltaL: BigNumberish) => Promise<Transaction>
export type BorrowFunction = (
  pid: BytesLike,
  recipient: string,
  nonce: BigNumberish,
  deltaL: BigNumberish,
  maxPremium: BigNumberish
) => Promise<Transaction>
export type RepayFunction = (
  pid: BytesLike,
  owner: string,
  nonce: BigNumberish,
  deltaL: BigNumberish
) => Promise<Transaction>

export interface EngineFunctions {
  deposit: DepositFunction
  withdraw: WithdrawFunction
  addLiquidity: AddLiquidityFunction
  swapXForY: SwapFunction
  swapYForX: SwapFunction
  create: CreateFunction
  lend: LendFunction
  claim: ClaimFunction
  borrow: BorrowFunction
  repay: RepayFunction
}

// ===== Engine Functions ====
export function createEngineFunctions({
  target,
  TX1,
  TY2,
  engine,
}: {
  target: TestCallee
  TX1: IERC20
  TY2: IERC20
  engine: TestEngine
}): EngineFunctions {
  const deposit: DepositFunction = async (deltaX: BigNumberish, deltaY: BigNumberish): Promise<Transaction> => {
    await TX1.approve(target.address, constants.MaxUint256)
    await TY2.approve(target.address, constants.MaxUint256)
    return target.deposit(target.address, deltaX, deltaY)
  }

  const withdraw: WithdrawFunction = async (deltaX: BigNumberish, deltaY: BigNumberish): Promise<Transaction> => {
    return engine.withdraw(deltaX, deltaY)
  }

  const addLiquidity: AddLiquidityFunction = async (
    pid: BytesLike,
    nonce: BigNumberish,
    deltaL: BigNumberish
  ): Promise<Transaction> => {
    await TX1.approve(target.address, constants.MaxUint256)
    await TY2.approve(target.address, constants.MaxUint256)
    return target.addLiquidity(pid, nonce, deltaL)
  }

  const swap = async (
    pid: BytesLike | string,
    addXRemoveY: boolean,
    deltaOut: BigNumberish,
    deltaInMax: BigNumberish
  ): Promise<Transaction> => {
    await TX1.approve(target.address, constants.MaxUint256)
    await TY2.approve(target.address, constants.MaxUint256)
    return target.swap(pid, addXRemoveY, deltaOut, deltaInMax)
  }

  const swapXForY: SwapFunction = (pid: BytesLike, deltaOut: BigNumberish, deltaInMax: BigNumberish) => {
    return swap(pid, true, deltaOut, deltaInMax)
  }
  const swapYForX: SwapFunction = (pid: BytesLike, deltaOut: BigNumberish, deltaInMax: BigNumberish) => {
    return swap(pid, false, deltaOut, deltaInMax)
  }

  const create: CreateFunction = async (calibration: Calibration, spot: BigNumberish): Promise<Transaction> => {
    // get delta of pool's calibration
    const delta = await engine.callDelta(calibration, spot)
    // set risky reserve to 1 - delta
    const RX1 = parseWei(1 - fromMantissa(fromInt(delta.toString())))
    // set riskless reserve using trading function
    const RY2 = parseWei(getTradingFunction(RX1, parseWei('1'), calibration))
    // mint the tokens to the engine before we call create()
    await TX1.mint(engine.address, RX1.raw)
    await TY2.mint(engine.address, RY2.raw)
    return engine.create(calibration, spot)
  }

  const lend: LendFunction = async (pid: BytesLike, nonce: BigNumberish, deltaL: BigNumberish): Promise<Transaction> => {
    return engine.lend(pid, nonce, deltaL)
  }

  const claim: ClaimFunction = async (pid: BytesLike, nonce: BigNumberish, deltaL: BigNumberish): Promise<Transaction> => {
    return engine.claim(pid, nonce, deltaL)
  }
  const borrow: BorrowFunction = async (
    pid: BytesLike,
    recipient: string,
    nonce: BigNumberish,
    deltaL: BigNumberish,
    maxPremium: BigNumberish
  ): Promise<Transaction> => {
    return target.borrow(pid, recipient, nonce, deltaL, maxPremium)
  }
  const repay: RepayFunction = async (
    pid: BytesLike,
    owner: string,
    nonce: BigNumberish,
    deltaL: BigNumberish
  ): Promise<Transaction> => {
    return target.repay(pid, owner, nonce, deltaL)
  }

  return {
    deposit,
    withdraw,
    addLiquidity,
    swapXForY,
    swapYForX,
    create,
    lend,
    claim,
    borrow,
    repay,
  }
}

// ===== Create =====

// ===== Margin =====

// ===== Liquidity =====

export function addBoth(deltaL: Wei, params: PoolParams): [Wei, Wei, PoolParams, number] {
  const { RX1, RY2, liquidity, float } = params.reserve
  const deltaX = deltaL.mul(RX1).div(liquidity)
  const deltaY = deltaL.mul(RY2).div(liquidity)
  const postRX1 = deltaX.add(RX1)
  const postRY2 = deltaY.add(RY2)
  const postLiquidity = deltaL.add(liquidity)
  const post: PoolParams = {
    reserve: {
      RX1: postRX1,
      RY2: postRY2,
      liquidity: postLiquidity,
      float: float,
    },
    calibration: params.calibration,
  }
  const postInvariant: number = calculateInvariant(post)
  return [deltaX, deltaY, post, postInvariant]
}

export function removeBoth(deltaL: Wei, params: PoolParams): [Wei, Wei, PoolParams, number] {
  const { RX1, RY2, liquidity, float } = params.reserve
  const deltaX = deltaL.mul(RX1).div(liquidity)
  const deltaY = deltaL.mul(RY2).div(liquidity)
  const postRX1 = RX1.sub(deltaX)
  const postRY2 = RY2.sub(deltaY)
  const postLiquidity = liquidity.sub(deltaL)
  const post: PoolParams = {
    reserve: {
      RX1: postRX1,
      RY2: postRY2,
      liquidity: postLiquidity,
      float: float,
    },
    calibration: params.calibration,
  }
  const postInvariant: number = calculateInvariant(post)
  return [deltaX, deltaY, post, postInvariant]
}

// ===== Swaps =====

export interface Swap {
  deltaIn: Wei
  deltaOut: Wei
  postParams: PoolParams
  postInvariant: number
}

/**
 * @notice  Calculates the required deltaIn if requesting deltaOut
 * @param deltaOut The amount of tokens requested out (swapped out of pool)
 * @param addXRemoveY The swap direction, if true, swap X to Y, else swap Y to X
 * @param invariantInt128 The previous invariant of the pool
 * @param params The pool's parameters, including calibration and reserve/liquidity
 * @returns deltaIn The required amount of tokens that must enter the pool to preserve invariant
 */
export function getDeltaIn(deltaOut: Wei, addXRemoveY: boolean, invariantInt128: string, params: PoolParams): Swap {
  let deltaIn: Wei
  const RX1: Wei = params.reserve.RX1
  const RY2: Wei = params.reserve.RY2
  const invariant: Wei = parseWei(fromInt(invariantInt128))
  let postRX1: Wei = new Wei('0')
  let postRY2: Wei = new Wei('0')

  if (addXRemoveY) {
    postRX1 = calcRX1WithYOut(deltaOut, params)
    postRY2 = RY2.sub(deltaOut)
    deltaIn = postRX1.gt(RX1) ? postRX1.sub(RX1) : RX1.sub(postRX1)
  } else {
    postRY2 = calcRY2WithXOut(deltaOut, params)
    postRX1 = RX1.sub(deltaOut)
    deltaIn = postRY2.gt(RY2) ? postRY2.sub(RY2) : RY2.sub(postRY2)
  }

  const postParams: PoolParams = {
    reserve: {
      RX1: postRX1,
      RY2: postRY2,
      liquidity: params.reserve.liquidity,
      float: params.reserve.float,
    },
    calibration: params.calibration,
  }
  const postInvariant: number = calculateInvariant(postParams)
  return { deltaIn, deltaOut, postParams, postInvariant }
}

export function getDeltaOut(deltaIn: Wei, addXRemoveY: boolean, invariantInt128: string, params: PoolParams): Swap {
  let deltaOut: Wei
  const RX1: Wei = params.reserve.RX1
  const RY2: Wei = params.reserve.RY2
  const invariant: Wei = parseWei(fromInt(invariantInt128))
  let postRX1: Wei = new Wei('0')
  let postRY2: Wei = new Wei('0')

  if (addXRemoveY) {
    postRX1 = RX1.add(deltaIn)
    postRY2 = calcRY2WithXIn(postRX1, params)
    deltaOut = postRY2.gt(RY2) ? postRY2.sub(RY2) : RY2.sub(postRY2)
  } else {
    let nextRY2 = calcRY2WithXIn(deltaIn, params)
    postRY2 = invariant.add(nextRY2)
    postRX1 = RX1.add(deltaIn)
    deltaOut = postRX1.gt(RX1) ? postRX1.sub(RX1) : RX1.sub(postRX1)
  }

  const postParams: PoolParams = {
    reserve: {
      RX1: postRX1,
      RY2: postRY2,
      liquidity: params.reserve.liquidity,
      float: params.reserve.float,
    },
    calibration: params.calibration,
  }
  const postInvariant: number = calculateInvariant(postParams)
  return { deltaIn, deltaOut, postParams, postInvariant }
}

export function calcRX1WithYOut(deltaY: Wei, params: PoolParams): Wei {
  const RY2: Wei = params.reserve.RY2
  const nextRY2 = RY2.sub(deltaY)
  return parseWei(calcRX1WithRY2(nextRY2, params))
}

export function calcRY2WithXOut(deltaX: Wei, params: PoolParams): Wei {
  const RX1 = params.reserve.RX1
  const nextRX1 = RX1.sub(deltaX)
  return parseWei(calcRY2WithRX1(nextRX1, params))
}

export function calcRX1WithYIn(deltaY: Wei, params: PoolParams): Wei {
  const RY2: Wei = params.reserve.RY2
  const nextRY2 = RY2.add(deltaY)
  return parseWei(calcRX1WithRY2(nextRY2, params))
}

export function calcRY2WithXIn(deltaX: Wei, params: PoolParams): Wei {
  const RX1 = params.reserve.RX1
  const nextRX1 = RX1.add(deltaX)
  return parseWei(calcRY2WithRX1(nextRX1, params))
}

export function calcRX1WithRY2(RY2: Wei, params: PoolParams) {
  return getInverseTradingFunction(RY2, params.reserve.liquidity, params.calibration)
}

export function calcRY2WithRX1(RX1: Wei, params: PoolParams) {
  return getTradingFunction(RX1, params.reserve.liquidity, params.calibration)
}

// ===== Lending =====

// ===== View =====

export interface Reserve {
  RX1: Wei
  RY2: Wei
  liquidity: Wei
  float: Wei
}

export async function getReserve(engine: Contract, poolId: string, log?: boolean): Promise<Reserve> {
  const res = await engine.getReserve(poolId)
  const reserve: Reserve = {
    RX1: new Wei(res.RX1),
    RY2: new Wei(res.RY2),
    liquidity: new Wei(res.liquidity),
    float: new Wei(res.float),
  }
  if (log)
    console.log(`
      RX1: ${formatEther(res.RX1)},
      RY2: ${formatEther(res.RY2)},
      liquidity: ${formatEther(res.liquidity)},
      float: ${formatEther(res.float)}
    `)
  return reserve
}

export interface Position {
  owner: string
  nonce: number
  BX1: Wei
  BY2: Wei
  liquidity: Wei
  float: Wei
  debt: Wei
  unlocked: boolean
}

export async function getPosition(
  engine: Contract,
  owner: string,
  nonce: number,
  pid: BytesLike,
  log?: boolean
): Promise<Position> {
  const pos = await engine.getPosition(owner, nonce, pid)
  const position: Position = {
    owner: pos.owner,
    nonce: pos.nonce,
    BX1: new Wei(pos.BX1),
    BY2: new Wei(pos.BY2),
    liquidity: new Wei(pos.liquidity),
    float: new Wei(pos.float),
    debt: new Wei(pos.debt),
    unlocked: pos.unlocked,
  }
  if (log)
    console.log(`
      owner: ${pos.owner},
      nonce: ${pos.nonce},
      BX1: ${formatEther(pos.BX1)},
      BY2: ${formatEther(pos.BY2)},
      liquidity: ${formatEther(pos.liquidity)},
      float: ${formatEther(pos.float)},
      debt: ${formatEther(pos.debt)}
      unlocked: ${pos.unlocked}
    `)
  return position
}

export interface Margin {
  owner: string
  BX1: Wei
  BY2: Wei
  unlocked: boolean
}

export async function getMargin(engine: Contract, owner: string, log?: boolean): Promise<Margin> {
  const mar = await engine.getMargin(owner)
  const margin: Margin = {
    owner: owner,
    BX1: new Wei(mar.BX1),
    BY2: new Wei(mar.BY2),
    unlocked: mar.unlocked,
  }
  if (log)
    console.log(`
      owner: ${owner},
      BX1: ${formatEther(mar.BX1)},
      BY2: ${formatEther(mar.BY2)},
      unlocked: ${mar.unlocked}
    `)
  return margin
}

export interface Calibration {
  strike: BigNumber
  sigma: number
  time: number
}

export async function getCalibration(engine: Contract, poolId: string, log?: boolean): Promise<Calibration> {
  const cal = await engine.getCalibration(poolId)
  const calibration: Calibration = {
    strike: toBN(cal.strike),
    sigma: +cal.sigma,
    time: +cal.time,
  }
  if (log)
    console.log(`
        Strike: ${formatEther(cal.strike)},
        Sigma:  ${cal.sigma},
        Time:   ${cal.time}
      `)
  return calibration
}

export interface PoolParams {
  reserve: Reserve
  calibration: Calibration
}

export async function getPoolParams(engine: Contract, poolId: string, log?: boolean): Promise<PoolParams> {
  const reserve: Reserve = await getReserve(engine, poolId, log)
  const calibration: Calibration = await getCalibration(engine, poolId, log)
  return { reserve, calibration }
}

export function calculateInvariant(params: PoolParams): number {
  const input: number = getTradingFunction(params.reserve.RX1, params.reserve.liquidity, params.calibration)
  const invariant: Wei = params.reserve.RY2.sub(parseEther(input > 0.0001 ? input.toString() : '0'))
  return invariant.float
}
