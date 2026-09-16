import { BrowserProvider, Contract, Interface, keccak256, toUtf8Bytes } from 'ethers'

export const BOT = { chainId: 968, chainIdHex: '0x3c8', name: 'BOT Chain Testnet', rpc: 'https://rpc.bohr.life', nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, explorer: 'https://scan.bohr.life' } as const
export const CONTRACT_ADDRESS = import.meta.env.VITE_DRIFT_CONTRACT_ADDRESS?.trim() || ''
export const ABI = [
  'function anchor(bytes32 rehearsalId, bytes32 artifactHash)',
  'function receipts(bytes32) view returns (address author, bytes32 rehearsalId, bytes32 artifactHash, uint64 createdAt)',
  'function schemaVersion() view returns (string)',
  'function targetChainId() view returns (uint256)',
  'event ReceiptAnchored(bytes32 indexed rehearsalId, bytes32 indexed artifactHash, address indexed author, uint64 createdAt)',
] as const
const receiptInterface = new Interface(ABI)

export type ChainStatus = { chainId: number; block: number; codeBytes: number; targetChain: number; schema: string }
export type AnchoredReceipt = { author: string; rehearsalId: string; artifactHash: string; createdAt: number }

export async function rpcRead<T>(method: 'eth_chainId' | 'eth_blockNumber' | 'eth_getCode' | 'eth_call', params: unknown[] = []): Promise<T> {
  const response = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
  const body = await response.json() as { result?: T; error?: string }
  if (!response.ok || body.error) throw new Error(body.error || `RPC read failed (${response.status}).`)
  return body.result as T
}

export async function readChainStatus(): Promise<ChainStatus> {
  if (!CONTRACT_ADDRESS) throw new Error('Set VITE_DRIFT_CONTRACT_ADDRESS to enable contract read-back.')
  const [chainHex, blockHex, code] = await Promise.all([
    rpcRead<string>('eth_chainId'), rpcRead<string>('eth_blockNumber'), rpcRead<string>('eth_getCode', [CONTRACT_ADDRESS, 'latest']),
  ])
  const chainId = Number.parseInt(chainHex, 16)
  if (chainId !== BOT.chainId) throw new Error(`Expected testnet 968; RPC reported ${chainId}.`)
  if (code === '0x') throw new Error('Configured receipt address has no code on BOT Chain Testnet.')
  const [targetResult, schemaResult] = await Promise.all([
    rpcRead<string>('eth_call', [{ to: CONTRACT_ADDRESS, data: receiptInterface.encodeFunctionData('targetChainId') }, 'latest']),
    rpcRead<string>('eth_call', [{ to: CONTRACT_ADDRESS, data: receiptInterface.encodeFunctionData('schemaVersion') }, 'latest']),
  ])
  const [targetChain] = receiptInterface.decodeFunctionResult('targetChainId', targetResult)
  const [schema] = receiptInterface.decodeFunctionResult('schemaVersion', schemaResult)
  if (Number(targetChain) !== BOT.chainId) throw new Error(`Configured contract targets chain ${Number(targetChain)}, not 968.`)
  if (String(schema) !== 'bot-drift-receipt-v1') throw new Error(`Unexpected receipt schema: ${String(schema)}.`)
  return { chainId, block: Number.parseInt(blockHex, 16), codeBytes: (code.length - 2) / 2, targetChain: Number(targetChain), schema: String(schema) }
}

export function artifactHashes(id: string, artifact: unknown) {
  return { rehearsalId: keccak256(toUtf8Bytes(`drift:${id}`)), artifactHash: keccak256(toUtf8Bytes(JSON.stringify(artifact))) }
}

export type WalletContext = { provider: BrowserProvider; account: string; chainId: number }
export type InjectedProvider = import('ethers').Eip1193Provider & {
  on?: (event: 'accountsChanged' | 'chainChanged', listener: (value: string[] | string) => void) => void
  removeListener?: (event: 'accountsChanged' | 'chainChanged', listener: (value: string[] | string) => void) => void
}

export async function connectWallet(): Promise<WalletContext> {
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('No injected EVM wallet found. Install or enable a wallet, then try again.')
  const provider = new BrowserProvider(ethereum)
  const accounts = await provider.send('eth_requestAccounts', []) as string[]
  if (!accounts[0]) throw new Error('Wallet returned no account.')
  let network = await provider.getNetwork()
  if (Number(network.chainId) !== BOT.chainId) {
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: BOT.chainIdHex }])
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error
      await provider.send('wallet_addEthereumChain', [{ chainId: BOT.chainIdHex, chainName: BOT.name, rpcUrls: [BOT.rpc], nativeCurrency: BOT.nativeCurrency, blockExplorerUrls: [BOT.explorer] }])
      await provider.send('wallet_switchEthereumChain', [{ chainId: BOT.chainIdHex }])
    }
    network = await provider.getNetwork()
  }
  if (Number(network.chainId) !== BOT.chainId) throw new Error('Wallet remained on the wrong network.')
  return { provider, account: accounts[0], chainId: Number(network.chainId) }
}

export async function anchorArtifact(wallet: WalletContext, id: string, artifact: unknown, onState?: (state: 'simulation' | 'wallet' | 'pending' | 'confirmation') => void) {
  if (!CONTRACT_ADDRESS) throw new Error('Contract address is not configured.')
  if (wallet.chainId !== BOT.chainId) throw new Error('Switch the wallet to BOT Chain Testnet before anchoring.')
  const hashes = artifactHashes(id, artifact)
  const provider = new Contract(CONTRACT_ADDRESS, ABI, wallet.provider)
  const prior = await provider.receipts(hashes.rehearsalId)
  if (Number(prior.createdAt) !== 0) throw new Error('This rehearsal ID is already anchored. Create a new revision before retrying.')
  const signer = await wallet.provider.getSigner(wallet.account)
  const writable = provider.connect(signer) as Contract
  onState?.('simulation')
  await writable.anchor.staticCall(hashes.rehearsalId, hashes.artifactHash)
  onState?.('wallet')
  const transaction = await writable.anchor(hashes.rehearsalId, hashes.artifactHash)
  onState?.('pending')
  const receipt = await transaction.wait(1)
  if (!receipt || receipt.status !== 1) throw new Error('Anchor transaction reverted or was not confirmed.')
  onState?.('confirmation')
  const confirmed = await provider.receipts(hashes.rehearsalId)
  if (confirmed.artifactHash.toLowerCase() !== hashes.artifactHash.toLowerCase() || confirmed.rehearsalId.toLowerCase() !== hashes.rehearsalId.toLowerCase()) throw new Error('Transaction confirmed, but receipt read-back did not match the submitted commitment.')
  return { ...hashes, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, author: confirmed.author, createdAt: Number(confirmed.createdAt) }
}

declare global { interface Window { ethereum?: InjectedProvider } }
