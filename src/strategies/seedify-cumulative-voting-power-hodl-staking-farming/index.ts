import { multicall } from '../../utils';
import { Multicaller } from '../../utils';
import { strategy as erc20BalanceOfStrategy } from '../erc20-balance-of';
import {
  createCallToReadUsersData,
  createStakingPromises,
  toDecimals,
  calculateBep20InLPForUser,
  getStakingBalanceOf
} from './utils';
import { farmingAbi, bep20Abi } from './utils';

export const author = 'theo6890';
export const version = '0.1.0';

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
): Promise<Record<string, number>> {
  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

  // required to use: erc20BalanceOfStrategy
  options.address = options.sfundAddress;

  //////// return SFUND, in user's wallet ////////
  let score: any = await erc20BalanceOfStrategy(
    space,
    network,
    provider,
    addresses,
    options,
    snapshot
  );

  //////// return LP deposited into farming contract ////////
  const farming = await multicall(
    network,
    provider,
    farmingAbi,
    [
      // from SFUND-BNB pool
      ...createCallToReadUsersData(
        addresses,
        options.farmingAddress_SFUND_BNB,
        'userDeposits'
      ),
      ...createCallToReadUsersData(
        addresses,
        options.legacyfarmingAddress_SFUND_BNB,
        'userDeposits'
      ),
      // from SNFTS-SFUND pool
      ...createCallToReadUsersData(
        addresses,
        options.farmingAddress_SNFTS_SFUND,
        'userDeposits'
      )
    ],
    { blockTag }
  );
  const sfundBnbCurrentFarming = farming.slice(0, addresses.length);
  const sfundBnbLegacyFarming = farming.slice(
    addresses.length,
    1 + addresses.length * 2
  );
  const snftsSfundFarming = farming.slice(
    1 + addresses.length * 2,
    farming.length
  );

  //////// return user's SFUND balance in staking contract (IDOLocking) ////////
  let sfundStaking: any = createStakingPromises(options.sfundStakingAddresses);
  let legacySfundStaking: any = createStakingPromises(
    options.legacySfundStakingAddresses
  );

  const result = await Promise.all([
    score,
    ...sfundStaking,
    ...legacySfundStaking
  ]);

  score = result[0];
  sfundStaking = result.slice(1, 1 + options.sfundStakingAddresses.length);
  legacySfundStaking = result.slice(
    2,
    2 + options.legacySfundStakingAddresses.length
  );

  const erc20Multi = new Multicaller(network, provider, bep20Abi, {
    blockTag
  });

  erc20Multi.call(
    'sfundBnbTotalSupply',
    options.lpAddress_SFUND_BNB,
    'totalSupply'
  );
  erc20Multi.call('sfundInSfundBnbPool', options.sfundAddress, 'balanceOf', [
    options.lpAddress_SFUND_BNB
  ]);
  erc20Multi.call(
    'snftsSfundTotalSupply',
    options.lpAddress_SNFTS_SFUND,
    'totalSupply'
  );
  erc20Multi.call('sfundInSnftsSfundPool', options.sfundAddress, 'balanceOf', [
    options.lpAddress_SNFTS_SFUND
  ]);

  const erc20Result = await erc20Multi.execute();

  const sfundBnbTotalSupply = toDecimals(erc20Result.sfundBnbTotalSupply);
  const sfundInSfundBnbPool = toDecimals(erc20Result.sfundInSfundBnbPool);
  const snftsSfundTotalSupply = toDecimals(erc20Result.snftsSfundTotalSupply);
  const sfundInSnftsSfundPool = toDecimals(erc20Result.sfundInSnftsSfundPool);

  return Object.fromEntries(
    Object.entries(score).map((sfundBalance: any, userIndex) => [
      sfundBalance[0],
      sfundBalance[1] +
        ////// SFUND from SFUND-BNB farming contracts (current & legacy) //////
        calculateBep20InLPForUser(
          sfundBnbCurrentFarming[userIndex],
          sfundBnbTotalSupply,
          sfundInSfundBnbPool
        ) +
        calculateBep20InLPForUser(
          sfundBnbLegacyFarming[userIndex],
          sfundBnbTotalSupply,
          sfundInSfundBnbPool
        ) +
        ////// SFUND from SFNTS-SFUND farming contract //////
        calculateBep20InLPForUser(
          snftsSfundFarming[userIndex],
          snftsSfundTotalSupply,
          sfundInSnftsSfundPool
        ) +
        ////// SFUND from staking contracts (current & legacy) //////
        getStakingBalanceOf(sfundStaking, userIndex) +
        getStakingBalanceOf(legacySfundStaking, userIndex)
    ])
  );
}
