import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import '@babylonjs/core/Meshes/thinInstanceMesh'

// ---------- setup ----------
const canvas = document.getElementById('game') as HTMLCanvasElement
const engine = new Engine(canvas, true)
const scene = new Scene(engine)
scene.clearColor = new Color4(0.01, 0.01, 0.03, 1)

const camera = new FreeCamera('cam', new Vector3(0, 26, -30), scene)
camera.setTarget(Vector3.Zero())
camera.fov = 0.9

new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.4

const glow = new GlowLayer('glow', scene)
glow.intensity = 1.2

function neonMat(name: string, hex: string, emissiveScale = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene)
  const c = Color3.FromHexString(hex)
  m.emissiveColor = c.scale(emissiveScale)
  m.diffuseColor = c.scale(0.25)
  return m
}

const matShip = neonMat('ship', '#00ffff')
const matBullet = neonMat('bullet', '#ffffff')
const matRockA = neonMat('rockA', '#ff00aa')
const matRockB = neonMat('rockB', '#ffaa00')
const matStar = neonMat('star', '#66aaff', 0.5)
const matTriple = neonMat('triple', '#00ff66')
const matShieldPU = neonMat('puShield', '#ffff00')

// starfield
{
  const stars = MeshBuilder.CreateGround('stars', { width: 400, height: 600 }, scene)
  stars.position.z = 150
  stars.material = matStar
  stars.isPickable = false
  const pm = new StandardMaterial('starfieldPM', scene)
  pm.emissiveTexture = new Texture('starfield.png', scene)
  stars.material = pm
}

// ---------- state ----------
interface Rock { mesh: Mesh; hp: number; speed: number; spin: number; big: boolean }
interface PowerUp { mesh: Mesh; kind: 'triple' | 'shield' }
const rocks: Rock[] = []
const bullets: { mesh: Mesh; vz: number; vx: number }[] = []
const powerups: PowerUp[] = []
let ship!: Mesh
let score = 0
let lives = 3
let running = false
let spawnTimer = 0
let fireCooldown = 0
let shakeT = 0
let powerTimer = 10
let tripleT = 0
let shieldOn = false
let shieldMesh: Mesh | null = null
let best = Number(localStorage.getItem('neonvoid-best') ?? 0)

const hudScore = document.querySelector('#hud .score')!
const hudLives = document.querySelector('#hud .lives')!
const hudBest = document.querySelector('#hud .best')!
const overlay = document.getElementById('overlay')!

function setHud() {
  hudScore.textContent = String(score).padStart(6, '0')
  hudLives.textContent = lives > 0 ? '♥'.repeat(lives) : ''
  hudBest.textContent = `BEST ${String(best).padStart(6, '0')}`
}
setHud()

// ---------- audio (Web Audio synth) ----------
let actx: AudioContext | null = null
function beep(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.12) {
  try {
    actx ??= new AudioContext()
    const o = actx.createOscillator()
    const g = actx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, actx.currentTime)
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), actx.currentTime + dur)
    g.gain.setValueAtTime(vol, actx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur)
    o.connect(g).connect(actx.destination)
    o.start()
    o.stop(actx.currentTime + dur)
  } catch { /* audio unavailable */ }
}
function noise(dur: number, vol = 0.22) {
  try {
    actx ??= new AudioContext()
    const n = Math.floor(actx.sampleRate * dur)
    const buf = actx.createBuffer(1, n, actx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
    const src = actx.createBufferSource()
    src.buffer = buf
    const g = actx.createGain()
    g.gain.value = vol
    src.connect(g).connect(actx.destination)
    src.start()
  } catch { /* audio unavailable */ }
}
const sfxShoot = () => beep('square', 880, 220, 0.08, 0.05)
const sfxBoom = () => noise(0.35)
const sfxPower = () => { beep('sine', 440, 1320, 0.18); setTimeout(() => beep('sine', 660, 1760, 0.15), 90) }
const sfxOver = () => beep('triangle', 300, 40, 0.8, 0.15)

function startGame() {
  for (const r of rocks) r.mesh.dispose()
  rocks.length = 0
  for (const b of bullets) b.mesh.dispose()
  bullets.length = 0
  for (const p of powerups) p.mesh.dispose()
  powerups.length = 0
  tripleT = 0
  shieldOn = false
  shieldMesh?.setEnabled(false)
  score = 0
  lives = 3
  powerTimer = 8
  if (!ship) buildShip()
  else { ship.setEnabled(true); ship.position.set(0, 0, -22) }
  overlay.classList.add('hidden')
  running = true
  setHud()
}

window.addEventListener('keydown', (e) => {
  if (!running) { startGame(); return }
  keys.add(e.code)
})
window.addEventListener('keyup', (e) => keys.delete(e.code))

const keys = new Set<string>()

// ---------- entities ----------
function buildShip() {
  ship = MeshBuilder.CreateBox('ship', { width: 1.6, height: 0.5, depth: 2.6 }, scene)
  const nose = MeshBuilder.CreateCylinder('nose', { diameterTop: 0, diameterBottom: 1.2, height: 1.6, tessellation: 4 }, scene)
  nose.rotation.x = Math.PI / 2
  nose.rotation.y = Math.PI / 4
  nose.position.z = 1.9
  nose.parent = ship
  ship.material = matShip
  ship.position.set(0, 0, -22)

  // engine trail
  const trail = new ParticleSystem('trail', 300, scene)
  trail.particleTexture = new Texture('spark.png', scene)
  trail.emitter = new Vector3(0, 0, 0)
  trail.minEmitBox = new Vector3(-0.3, 0, -1.4)
  trail.maxEmitBox = new Vector3(0.3, 0, -1.4)
  trail.color1 = new Color4(0, 1, 1, 1)
  trail.color2 = new Color4(0, 0.4, 1, 1)
  trail.colorDead = new Color4(0, 0, 0.2, 0)
  trail.minSize = 0.15
  trail.maxSize = 0.45
  trail.minLifeTime = 0.15
  trail.maxLifeTime = 0.4
  trail.emitRate = 220
  trail.direction1 = new Vector3(-0.2, 0, -2)
  trail.direction2 = new Vector3(0.2, 0, -4)
  trail.gravity = new Vector3(0, 0, -2)
  trail.start()
  // keep emitter glued to ship each frame
  scene.onBeforeRenderObservable.add(() => {
    ;(trail.emitter as Vector3).copyFrom(ship.position)
  })
}

function shoot(dx: number, vx: number) {
  const b = MeshBuilder.CreateSphere('bullet', { diameter: 0.35, segments: 6 }, scene)
  b.material = matBullet
  b.position.copyFrom(ship.position)
  b.position.z += 2
  b.position.x += dx
  bullets.push({ mesh: b, vz: 60, vx })
}

function fire() {
  if (tripleT > 0) {
    shoot(0, 0)
    shoot(-0.6, -14)
    shoot(0.6, 14)
  } else {
    shoot(0, 0)
  }
  sfxShoot()
}

function spawnPower() {
  const kind: PowerUp['kind'] = Math.random() < 0.5 ? 'triple' : 'shield'
  const mesh = MeshBuilder.CreatePolyhedron(`pu-${kind}`, { type: 1, size: 0.9 }, scene)
  mesh.material = kind === 'triple' ? matTriple : matShieldPU
  mesh.position.set((Math.random() - 0.5) * 30, -7 + Math.random() * 16, 100)
  powerups.push({ mesh, kind })
}

function activateShield() {
  shieldOn = true
  if (!shieldMesh) {
    shieldMesh = MeshBuilder.CreateTorus('shield', { diameter: 3.6, thickness: 0.25, tessellation: 24 }, scene)
    shieldMesh.material = matShieldPU
    shieldMesh.isPickable = false
  }
  shieldMesh.setEnabled(true)
}

function spawnRock() {
  const kind = Math.random() < 0.7 ? 'A' : 'B'
  const s = kind === 'A' ? 1.6 + Math.random() * 1.6 : 0.9 + Math.random() * 0.8
  const rock = MeshBuilder.CreatePolyhedron(`rock${kind}`, { type: kind === 'A' ? 2 : 1, size: s }, scene)
  rock.material = kind === 'A' ? matRockA : matRockB
  rock.position.set((Math.random() - 0.5) * 34, -8 + Math.random() * 18, 90 + Math.random() * 30)
  rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
  const r: Rock = {
    mesh: rock,
    hp: kind === 'A' ? 3 : 1,
    speed: (kind === 'A' ? 10 : 17) + Math.random() * 6,
    spin: 0.6 + Math.random() * 1.4,
    big: kind === 'A',
  }
  rocks.push(r)
}

function explode(pos: Vector3, hex: string) {
  const ps = new ParticleSystem('boom', 120, scene)
  ps.particleTexture = new Texture('spark.png', scene)
  ps.emitter = pos.clone()
  ps.color1 = Color4.FromHexString(hex + 'FF')
  ps.color2 = Color4.FromHexString(hex + 'AA')
  ps.colorDead = new Color4(0, 0, 0, 0)
  ps.minSize = 0.2
  ps.maxSize = 0.8
  ps.minLifeTime = 0.2
  ps.maxLifeTime = 0.6
  ps.createSphereEmitter(1.2)
  ps.manualEmitCount = 80
  ps.targetStopDuration = 0.05
  ps.disposeOnStop = true
  ps.start()
}

// ---------- loop ----------
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)
  if (!running || !ship) return

  // movement
  const vx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
  const vy = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
  ship.position.x += vx * 24 * dt
  ship.position.y += vy * 18 * dt
  ship.position.x = Math.max(-17, Math.min(17, ship.position.x))
  ship.position.y = Math.max(-8, Math.min(10, ship.position.y))
  ship.rotation.z = -vx * 0.45
  ship.rotation.x = vy * 0.2

  // fire
  fireCooldown -= dt
  if ((keys.has('Space')) && fireCooldown <= 0) {
    fire()
    fireCooldown = 0.18
  }

  // bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.mesh.position.z += b.vz * dt
    b.mesh.position.x += b.vx * dt
    if (b.mesh.position.z > 130) { b.mesh.dispose(); bullets.splice(i, 1); continue }
    for (let j = rocks.length - 1; j >= 0; j--) {
      const r = rocks[j]
      if (Vector3.Distance(b.mesh.position, r.mesh.position) < r.mesh.getBoundingInfo().boundingSphere.radiusWorld + 0.4) {
        r.hp--
        b.mesh.dispose(); bullets.splice(i, 1)
        if (r.hp <= 0) {
          explode(r.mesh.position, r.big ? '#ff00aa' : '#ffaa00')
          sfxBoom()
          r.mesh.dispose(); rocks.splice(j, 1)
          score += 100
          setHud()
        } else {
          score += 20
          setHud()
        }
        break
      }
    }
  }

  // rocks
  spawnTimer -= dt
  if (spawnTimer <= 0) {
    spawnRock()
    spawnTimer = Math.max(0.28, 0.9 - score / 8000)
  }

  // power-ups
  powerTimer -= dt
  if (powerTimer <= 0 && powerups.length < 2) {
    spawnPower()
    powerTimer = 9 + Math.random() * 7
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i]
    p.mesh.position.z -= 14 * dt
    p.mesh.rotation.y += 3 * dt
    p.mesh.rotation.x += 1.5 * dt
    if (p.mesh.position.z < -40) { p.mesh.dispose(); powerups.splice(i, 1); continue }
    if (Vector3.Distance(p.mesh.position, ship.position) < 2.4) {
      explode(p.mesh.position, p.kind === 'triple' ? '#00ff66' : '#ffff00')
      sfxPower()
      if (p.kind === 'triple') tripleT = 8
      else activateShield()
      p.mesh.dispose(); powerups.splice(i, 1)
    }
  }
  if (tripleT > 0) tripleT -= dt
  ship.material = tripleT > 0 ? matTriple : matShip
  if (shieldMesh?.isEnabled()) {
    shieldMesh.position.copyFrom(ship.position)
    shieldMesh.rotation.y += 4 * dt
  }

  for (let i = rocks.length - 1; i >= 0; i--) {
    const r = rocks[i]
    r.mesh.position.z -= r.speed * dt
    r.mesh.rotation.y += r.spin * dt
    r.mesh.rotation.x += r.spin * 0.4 * dt
    if (r.mesh.position.z < -40) { r.mesh.dispose(); rocks.splice(i, 1); continue }
    if (Vector3.Distance(r.mesh.position, ship.position) < r.mesh.getBoundingInfo().boundingSphere.radiusWorld + 1.2) {
      r.mesh.dispose(); rocks.splice(i, 1)
      if (shieldOn) {
        shieldOn = false
        shieldMesh?.setEnabled(false)
        explode(ship.position, '#ffff00')
        beep('sawtooth', 300, 100, 0.2, 0.15)
      } else {
        explode(ship.position, '#00ffff')
        sfxBoom()
        lives--
        shakeT = 0.4
        setHud()
        if (lives <= 0) {
          running = false
          if (score > best) { best = score; localStorage.setItem('neonvoid-best', String(best)) }
          setHud()
          overlay.querySelector('p:last-child')!.textContent = `GAME OVER — ${score} pts · récord ${best} · pulsa una tecla para reintentar`
          overlay.classList.remove('hidden')
          sfxOver()
        }
      }
    }
  }

  // camera shake
  if (shakeT > 0) {
    shakeT -= dt
    camera.position.x = (Math.random() - 0.5) * shakeT * 2
    camera.position.y = 26 + (Math.random() - 0.5) * shakeT * 2
  } else {
    camera.position.x *= 0.9
    camera.position.y += (26 - camera.position.y) * 0.1
  }
})

engine.runRenderLoop(() => scene.render())
window.addEventListener('resize', () => engine.resize())
