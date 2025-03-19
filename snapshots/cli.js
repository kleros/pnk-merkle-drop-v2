#!/usr/bin/env node
import dotenv from "dotenv";
import { BigNumber, Contract, getDefaultProvider } from "ethers";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { createSnapshotCreator } from "./src/create-snapshot-from-block-limits.js";
import fs from "fs";
import { fileToIpfs } from "./src/fileToIpfs.js";
import { addTransactionToBatch, writeTransactionBatch } from "./src/helpers/tx-builder.js";
dotenv.config();

dayjs.extend(utc);

const chains = [
  // ONLY uncomment Arbitrum Sepolia if you are testing
  // {
  //   chainId: 421614,
  //   chainShortName: "arb-sep", // https://chainid.network/shortNameMapping.json
  //   blocksPerSecond: 0.268,
  //   klerosCoreAddress: "0xA54e7A16d7460e38a8F324eF46782FB520d58CE8",
  //   token: "0x34B944D42cAcfC8266955D07A80181D2054aa225",
  //   pnkDropRatio: BigNumber.from("1000000000"),
  //   fromBlock: 3638878,
  //   provider: getDefaultProvider(process.env.INFURA_ARB_SEPOLIA_RPC),
  //   merkleDropAddress: "0x93024F2D53D180074F4575818dE3E8dcE8147CF2",
  //   safeAddress: "0x66e8DE9B42308c6Ca913D1EE041d6F6fD037A57e", // Safe not supported on Arbitrum Sepolia
  // },
  {
    chainId: 42161,
    chainShortName: "arb", // https://chainid.network/shortNameMapping.json
    blocksPerSecond: 0.26,
    klerosCoreAddress: "0x991d2df165670b9cac3B022f4B68D65b664222ea",
    token: "0x330bD769382cFc6d50175903434CCC8D206DCAE5",
    pnkDropRatio: BigNumber.from("1000000000"),
    fromBlock: 272063254,
    provider: getDefaultProvider(process.env.INFURA_ARB_ONE_RPC),
    merkleDropAddress: "0x2a23B84078b287753A91C522c3bB3b6B32f6F8f1",
    safeAddress: "0x66e8DE9B42308c6Ca913D1EE041d6F6fD037A57e",
  },
];

const argv = yargs(hideBin(process.argv))
  .strict(true)
  .locale("en")
  .usage(`Usage: $0 --lastamount={n}`)
  .epilogue("Alternatively you can set the same params in the .env file. Check .env.example.")
  .option("lastamount", {
    description: "The amount of tokens, in wei, that were distributed in the last period",
  })
  .option("json-rpc-url", {
    description: "The amount of tokens, in wei, that were distributed in the last period",
  })
  .string(["lastamount, json-rpc-url"]).argv;

const normalizeArgs = ({ lastamount }) => ({
  lastamount: BigNumber.from(String(lastamount)),
});

const { lastamount } = normalizeArgs(argv);

const getDatesAndPeriod = () => {
  const currentDate = new Date(); // Current date in local time zone
  const currentMonth = currentDate.getUTCMonth(); // Get current month in UTC
  const currentYear = currentDate.getUTCFullYear(); // Get current year in UTC

  // Calculate the start date as the first day of the previous month in UTC
  const startDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));

  // Calculate the end date as the first day of the current month in UTC
  const endDate = new Date(Date.UTC(currentYear, currentMonth, 1));

  const previousDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));

  // Calculate the periods based on the start date
  const baseYear = 2024;
  const baseMonth = 0; // January is 0 in Date.UTC
  const monthDiff = (currentYear - baseYear) * 12 + currentMonth - baseMonth - 1;

  // target starts at 29 for January 2024 and increases by 1 each period
  // maxes at 50
  const target = BigNumber.from(Math.min(29 + monthDiff, 50)).mul(BigNumber.from("10000000"));
  // arbitrumPeriod starts at 1 for January 2024 and increases by 1 each period
  // only used for _month argument in merkledrop.seedAllocations()
  const periods = { 42161: 1 + monthDiff, 421614: 1 + monthDiff };

  return { startDate, endDate, previousDate, target, periods };
};

const main = async () => {
  // get the utc dates of the period.
  const { startDate, endDate, previousDate, target, periods } = getDatesAndPeriod();

  // for each chain, count the "average" total pnk staked of the month.
  // to get this value, we can run the entire snapshot creator function,
  // create the entire merkle tree. not efficient but safer than modifying
  // working legacy.
  // getting this value implies getting it for all chains.
  const getTotalPNKStaked = async () => {
    let sum = BigNumber.from(0);
    for (const chain of chains) {
      console.log("Counting average PNK for chainId", chain.chainId);

      const createSnapshot = await createSnapshotCreator({
        provider: chain.provider,
        klerosCoreAddress: chain.klerosCoreAddress,
        droppedAmount: BigNumber.from(0), // we're not awarding anything, just counting.
      });
      const snapshot = await createSnapshot({
        fromBlock: chain.fromBlock,
        startDate: previousDate,
        endDate: startDate,
      });
      console.log(
        "[",
        chain.chainId,
        "] holds",
        BigNumber.from(snapshot.averageTotalStaked).div(BigNumber.from("1000000000000000000")).toString(),
        "PNK, that is,",
        BigNumber.from(snapshot.averageTotalStaked).div(BigNumber.from("1000000000000000000000000")).toString(),
        "millions"
      );
      sum = sum.add(snapshot.averageTotalStaked);
    }
    return sum;
  };
  const totalPNKStaked = await getTotalPNKStaked();

  // lets compute the formula to figure out how much will be awarded in total this month
  const pnkArbitrum = new Contract(
    chains[0].token,
    ["function totalSupply() view returns (uint256)"],
    chains[0].provider
  );
  const totalSupply = await pnkArbitrum.totalSupply();
  console.log(
    "Total PNK staked:",
    BigNumber.from(totalPNKStaked).div(BigNumber.from("1000000000000000000")).toString(),
    " PNK, that is,",
    BigNumber.from(totalPNKStaked).div(BigNumber.from("1000000000000000000000000")).toString(),
    "millions"
  );
  // basis points: 9 zeroes
  const basis = BigNumber.from(1000000000);
  const stakePercent = totalPNKStaked.mul(basis).div(totalSupply);
  const onePlusStakeMinusTarget = basis.add(target).sub(stakePercent);
  const fullReward = lastamount.mul(onePlusStakeMinusTarget).div(basis);

  console.log("total pnk supply:", totalSupply.toString(), "PNK in existence");
  console.log("Current percent staked, in ten thousand basis:", stakePercent.div(BigNumber.from(100000)).toString());
  console.log("Target is:", target.div(BigNumber.from(100000)).toString());
  console.log("Multiplier basis:", onePlusStakeMinusTarget.div(BigNumber.from(100000)).toString());

  console.log("FULL REWARD:", fullReward.toString(), "PNK (wei) will be rewarded");

  console.log("-----------");
  console.log("Generating Merkle Trees");
  console.log("-----------");

  const snapshotInfos = [];
  for (const c of chains) {
    const droppedAmount = fullReward.mul(c.pnkDropRatio).div(basis);
    console.log("> Chain [", c.chainId, "] ", droppedAmount.toString(), "PNK (wei) will be rewarded");
    const createSnapshot = await createSnapshotCreator({
      provider: c.provider,
      klerosCoreAddress: c.klerosCoreAddress,
      droppedAmount,
    });
    const snapshot = await createSnapshot({ fromBlock: c.fromBlock, startDate, endDate });
    snapshotInfos.push({
      // edit when arbitrum inclusion
      filename: `${c.chainId == "42161" ? "arbitrum-" : "arbitrumSepolia-"}snapshot-${startDate
        .toISOString()
        .slice(0, 7)}.json`,
      chain: c,
      snapshot,
      period: periods[c.chainId],
    });
  }

  // paste these into kleros/court
  for (const sinfo of snapshotInfos) {
    const path = `.cache/${sinfo.filename}`;
    fs.writeFileSync(path, JSON.stringify(sinfo.snapshot));
    const ipfsPath = await fileToIpfs(path);
    console.log(`https://cdn.kleros.link/ipfs/${ipfsPath}`);
  }

  // txs to run sequentially, hardcoded section.
  console.log("PNK should be already approved to MerkleRedeem contract for each chain");

  const merkleDropABI = ["function seedAllocations(uint _month, bytes32 _merkleRoot, uint _totalAllocation) external"];

  // Loop through snapshotInfos to generate transactions for each chain
  for (const sinfo of snapshotInfos) {
    const merkleContract = new Contract(sinfo.chain.merkleDropAddress, merkleDropABI);

    // Populate the seedAllocations transaction
    const tx = await merkleContract.populateTransaction.seedAllocations(
      sinfo.period, // The period (month) for this snapshot
      sinfo.snapshot.merkleTree.root, // The Merkle root from the snapshot
      sinfo.snapshot.droppedAmount // The total allocation to drop
    );

    addTransactionToBatch(tx);

    const { chainId, chainShortName, safeAddress } = sinfo.chain;
    writeTransactionBatch({
      name: "Seed allocations",
      chainId,
      chainShortName,
      safeAddress,
      outputPath: `tx-batch-${chainShortName}.json`,
    });
  }
};

main();
