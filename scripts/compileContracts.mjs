// Compile the Robinhood Chain contracts with solc-js.
//
// Output goes to a gitignored build directory; nothing here is a runtime asset.
// The vault still requires the independent review listed in contracts/README.md
// before it is used for anything but testnet.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');

const SOURCES = ['TokenCityVault.sol', 'TestProjectToken.sol'];
const outDir = resolve(process.cwd(), 'contracts/build');

export function compileContracts() {
  const input = {
    language: 'Solidity',
    sources: Object.fromEntries(SOURCES.map((file) => [
      file, { content: readFileSync(resolve(process.cwd(), 'contracts', file), 'utf8') },
    ])),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  if (errors.length) {
    for (const error of errors) console.error(error.formattedMessage);
    throw new Error('Solidity compilation failed');
  }
  for (const warning of (output.errors || []).filter((entry) => entry.severity === 'warning')) {
    console.warn(warning.formattedMessage.trim());
  }
  const artifacts = {};
  for (const file of SOURCES) {
    for (const [contractName, contract] of Object.entries(output.contracts[file] || {})) {
      artifacts[contractName] = {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
        solcVersion: solc.version(),
      };
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'artifacts.json'), JSON.stringify(artifacts, null, 2));
  return artifacts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifacts = compileContracts();
  for (const [name, artifact] of Object.entries(artifacts)) {
    console.log(`${name}: ${(artifact.bytecode.length - 2) / 2} bytes · solc ${artifact.solcVersion}`);
  }
  console.log(`Artifacts written to contracts/build/artifacts.json`);
}
