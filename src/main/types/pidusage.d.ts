declare module 'pidusage' {
  export interface Status {
    cpu: number
    memory: number
    ppid: number
    pid: number
    ctime: number
    elapsed: number
    timestamp: number
  }

  export interface Options {
    usePs?: boolean
    maxage?: number | string
  }

  export type Pid = number | string
  export type StatusMap = Record<string, Status>

  interface Pidusage {
    (pid: Pid, options?: Options): Promise<Status>
    (pids: Pid[], options?: Options): Promise<StatusMap>
    (pid: Pid, callback: (error: Error | null, result: Status) => void): void
    (pids: Pid[], callback: (error: Error | null, result: StatusMap) => void): void
    (pid: Pid, options: Options, callback: (error: Error | null, result: Status) => void): void
    (pids: Pid[], options: Options, callback: (error: Error | null, result: StatusMap) => void): void
    clear(): void
  }

  const pidusage: Pidusage
  export default pidusage
}
