import type { PetResult } from '../../core/pet/result'
import type { SaveData } from '../../shared/save'
import { publishChange, save } from './store'

/** The current UI has one synchronous command entry. Presentation consumes its committed result. */
export function command<T>(run: (state: SaveData) => PetResult<T>): PetResult<T> {
  const result = run(save)
  if (result.status === 'succeeded') publishChange(result.patch)
  return result
}
