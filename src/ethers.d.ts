declare module 'ethers' {
  export type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
  export class BrowserProvider {
    constructor(provider: Eip1193Provider)
    send(method: string, params: unknown[]): Promise<any>
    getNetwork(): Promise<{ chainId: bigint }>
    getSigner(account: string): Promise<any>
  }
  export class Contract {
    constructor(address: string, abi: readonly string[], provider: any)
    [key: string]: any
  }
  export class Interface {
    constructor(abi: readonly string[])
    encodeFunctionData(name: string, values?: unknown[]): string
    decodeFunctionResult(name: string, data: string): any[]
  }
  export function keccak256(data: string): string
  export function toUtf8Bytes(data: string): string
}
