export type TaskState = 'queued' | 'running' | 'waiting_input' | 'waiting_approval' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled'
export type MemoryKind = 'preference' | 'experience' | 'project'
export type TaskErrorCode = 'MODEL_REQUEST_FAILED' | 'APPLICATION_INTERRUPTED' | 'CONTEXT_CHANGED' | 'USER_CANCELLED'
export interface Identity {
  id: string
  revision: number
  personality: string
  address: string
}
export interface Memory {
  id: string
  revision: number
  kind: MemoryKind
  text: string
  source: string
  project: string
  updatedAt: number
}
export interface Conversation { id: string; title: string; updatedAt: number }
export interface ChatMessage { sequence: number; taskId: string; role: 'user' | 'assistant'; content: string; createdAt: number }
export interface Backend { id: 'local' | 'openai-compatible'; url: string; model: string }
export interface WorkTask {
  id: string
  requestId: string
  sessionId: string
  rootTaskId: string
  parentTaskId: string | null
  origin: 'chat'
  backend: Backend
  state: TaskState
  attempt: number
  contextRevision: number
  input: string
  output: string | null
  error: string | null
  errorCode: TaskErrorCode | null
  createdAt: number
  updatedAt: number
}
export interface TaskEvent { sequence: number; taskId: string; state: TaskState; attempt: number; errorCode: TaskErrorCode | null; detail: string; at: number }
export interface ChatContext { task: WorkTask; identity: Identity; memories: Memory[]; messages: ChatMessage[] }
export interface CompanionOperations {
  'identity.get': { input: Record<string, never>; output: Identity }
  'identity.put': { input: Pick<Identity, 'revision' | 'personality' | 'address'>; output: Identity }
  'memory.list': { input: { query: string }; output: Memory[] }
  'memory.put': { input: Omit<Memory, 'updatedAt'>; output: Memory }
  'memory.delete': { input: { id: string; revision: number }; output: void }
  'session.list': { input: Record<string, never>; output: Conversation[] }
  'session.create': { input: { id: string }; output: Conversation }
  'session.delete': { input: { id: string }; output: void }
  'chat.history': { input: { sessionId: string; before?: number }; output: ChatMessage[] }
  'chat.send': { input: { sessionId: string; requestId: string; message: string }; output: WorkTask }
  'task.list': { input: { sessionId: string }; output: WorkTask[] }
  'task.events': { input: { id: string; before?: number }; output: TaskEvent[] }
  'task.cancel': { input: { id: string }; output: WorkTask }
  'task.resume': { input: { id: string }; output: WorkTask }
}
export type CompanionOperation = keyof CompanionOperations
export type CompanionApi = <K extends CompanionOperation>(name: K, input: CompanionOperations[K]['input']) => Promise<CompanionOperations[K]['output']>
