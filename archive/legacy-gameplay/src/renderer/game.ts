import { SwfPlayer } from './swf/player'

const swf = new URLSearchParams(location.search).get('swf')!
document.title = swf.replace(/^.*\//, '').replace(/\.swf$/, '')
const player = new SwfPlayer(document.body)
// The stage keeps its aspect and fills the window; whatever lies off stage is hidden behind the bars.
async function start(): Promise<void> {
  await player.load(`pet/game/${swf}`, undefined, { letterbox: 'on' })
  player.el.focus()
}
void start().catch((error: unknown) => console.error('Game startup failed:', error))
