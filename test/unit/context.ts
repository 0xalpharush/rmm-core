import { createFixtureLoader, MockProvider } from 'ethereum-waffle'
import { Contracts, Functions, Mocks, ContractName } from '../../types'
import { Wallet } from 'ethers'
import createEngineFunctions from './createEngineFunctions'
import createTestContracts from './createTestContracts'
import { parseWei, PERCENTAGE, Percentage, Time, Wei, YEAR, BigNumber, toBN } from '../shared/sdk/Units'

interface Config {
  strike: Wei
  sigma: Percentage
  maturity: Time
  lastTimestamp: Time
  spot: Wei
}

export const config: Config = {
  strike: parseWei('2500'),
  sigma: new Percentage(toBN(PERCENTAGE * 1.1)),
  maturity: new Time(YEAR + +Date.now() / 1000),
  lastTimestamp: new Time(+Date.now() / 1000),
  spot: parseWei('1750'),
}

export default async function loadContext(
  provider: MockProvider,
  contracts: ContractName[],
  action?: (signers: Wallet[], contracts: Contracts) => Promise<void>
): Promise<void> {
  const loadFixture = createFixtureLoader(provider.getWallets(), provider)

  beforeEach(async function () {
    const loadedFixture = await loadFixture(async function (signers: Wallet[]) {
      const [deployer] = signers
      let loadedContracts: Contracts = {} as Contracts
      let loadedFunctions: Functions = {} as Functions

      loadedContracts = await createTestContracts(contracts, deployer)
      loadedFunctions = createEngineFunctions(contracts, loadedContracts, deployer)

      if (action) await action(signers, loadedContracts)

      return { contracts: loadedContracts, functions: loadedFunctions }
    })

    this.contracts = {} as Contracts
    this.functions = {} as Functions
    this.mocks = {} as Mocks
    this.signers = provider.getWallets()
    this.deployer = this.signers[0]

    Object.assign(this.contracts, loadedFixture.contracts)
    Object.assign(this.functions, loadedFixture.functions)
  })
}
