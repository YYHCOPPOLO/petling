import type { PetCommand, PetCommandName, PetCommands, PetOutcome } from '../../shared/pet-command'
import { client } from './store'

/** Presentation receives a result only after the host has durably committed it. */
export function command<K extends PetCommandName>(name: K, input: PetCommands[K]['input']): Promise<PetOutcome<PetCommands[K]['output']>> {
  return client.command({ name, input } as PetCommand) as Promise<PetOutcome<PetCommands[K]['output']>>
}
