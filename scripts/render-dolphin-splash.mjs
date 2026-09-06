/**
 * Offline authoring for the Dolphin launch artwork. No Three.js code ships in the app.
 * Requires Node 22+, ffmpeg and an existing Playwright installation with Chromium.
 * Run: node scripts/render-dolphin-splash.mjs [--preview]
 * PLAYWRIGHT_MODULE can point to a Playwright module outside the app dependencies.
 * The pinned renderer and intermediate frames are cached under ignored Agent/scratch.
 * API reference: https://threejs.org/docs/pages/BufferGeometry.html and
 * https://threejs.org/docs/pages/MeshPhysicalMaterial.html (verified 2026-09-06).
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(root, 'Agent/scratch/dolphin-render');
const frameDir = join(scratch, 'frames');
const preview = process.argv.includes('--preview');
const size = 512;
const fps = 24;
const duration = 3;
await mkdir(frameDir, { recursive: true });

// Authoring-only downloads: do not install a new dependency in the Expo project.
const version = '0.180.0';
for (const [file, remote] of [
  ['three.module.js', 'build/three.module.js'],
  ['three.core.js', 'build/three.core.js'],
  ['RoomEnvironment.js', 'examples/jsm/environments/RoomEnvironment.js'],
]) {
  try { await readFile(join(scratch, file)); } catch {
    const response = await fetch(`https://cdn.jsdelivr.net/npm/three@${version}/${remote}`);
    if (!response.ok) throw new Error(`Unable to download ${remote}: ${response.status}`);
    await writeFile(join(scratch, file), await response.text());
  }
}

// Self-contained browser scene. All geometry is authored here; no external model/license.
function createScene() {
  const { THREE, RoomEnvironment } = window;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512);
  renderer.setPixelRatio(2);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F6F4EE');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  scene.environment = pmrem.fromScene(studio, 0.06).texture;
  scene.environmentIntensity = 1.0;
  const camera = new THREE.OrthographicCamera(-2.9, 2.9, 2.9, -2.9, 0.1, 30);
  camera.position.set(-0.5, 3.1, 7);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9b697', 1.5));
  const key = new THREE.DirectionalLight('#fff6e5', 3.2);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 2.1);
  rim.position.set(3, 2, -4);
  scene.add(rim);
  const gold = new THREE.MeshPhysicalMaterial({
    color: '#D5AC60', metalness: 0.79, roughness: 0.26,
    clearcoat: 0.4, clearcoatRoughness: 0.22,
  });
  const darkGold = new THREE.MeshStandardMaterial({ color: '#6d4c26', metalness: 0.65, roughness: 0.35 });
  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: '#282d29', metalness: 0.1, roughness: 0.12, clearcoat: 1 });
  const dolphin = new THREE.Group();
  scene.add(dolphin);
  const deformable = [];

  function surface(rows, columns, point, material = gold, flip = false) {
    const positions = [];
    const indices = [];
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        positions.push(...point(row / rows, col / columns * Math.PI * 2));
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const a = row * (columns + 1) + col;
        const b = a + columns + 1;
        if (flip) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    dolphin.add(mesh);
    deformable.push({ mesh, original: new Float32Array(positions) });
    return mesh;
  }

  // x, center height, vertical radius, horizontal radius. The melon and rostrum
  // are one continuous surface, with a narrow peduncle connecting the flukes.
  const profile = [
    [-2.13, .055, .002, .002], [-2.10, .055, .055, .065],
    [-1.96, .06, .085, .105], [-1.68, .075, .1, .16],
    [-1.48, .12, .20, .26], [-1.30, .19, .33, .36],
    [-.98, .19, .415, .435], [-.50, .14, .43, .44],
    [.05, .065, .375, .375], [.60, -.06, .27, .265],
    [1.07, -.15, .175, .175], [1.48, -.17, .105, .10],
    [1.83, -.13, .07, .065], [2.02, -.09, .05, .07],
    [2.08, -.09, .002, .002],
  ];
  function interpolate(t, component) {
    const progress = t * (profile.length - 1);
    const i = Math.min(Math.floor(progress), profile.length - 2);
    const f = progress - i;
    const p0 = profile[Math.max(0, i - 1)][component];
    const p1 = profile[i][component];
    const p2 = profile[i + 1][component];
    const p3 = profile[Math.min(profile.length - 1, i + 2)][component];
    return .5 * ((2*p1) + (-p0+p2)*f + (2*p0-5*p1+4*p2-p3)*f*f + (-p0+3*p1-3*p2+p3)*f*f*f);
  }
  surface(180, 72, (t, angle) => [
    interpolate(t, 0), interpolate(t, 1) + Math.max(.001, interpolate(t, 2)) * Math.cos(angle),
    Math.max(.001, interpolate(t, 3)) * Math.sin(angle),
  ], gold, true);

  // Smooth, tapered airfoil sections give the fins rounded leading edges.
  surface(52, 40, (t, angle) => {
    const chord = .45 * Math.pow(1-t, 1.9) + .003;
    return [.03 + .55*t + chord*Math.cos(angle), .30 + .73*t,
      (.115 * Math.pow(1-t, 1.2) + .002) * Math.sin(angle)];
  });

  for (const side of [-1, 1]) {
    surface(48, 40, (t, angle) => {
      const chord = .31 * Math.pow(1-t, .7) + .002;
      return [-.78 + .79*t + chord*Math.cos(angle),
        -.18 - .49*t + .08*t*t + (.075*Math.pow(1-t, 1.2)+.001)*Math.sin(angle),
        side * (.27 + .84*t)];
    }, gold, side < 0);
    surface(52, 40, (t, angle) => {
      const chord = .29 * Math.pow(1-t, .85) + .002;
      return [1.92 + .39*t + .04*Math.sin(Math.PI*t) + chord*Math.cos(angle),
        -.13 + .06*t + (.055*Math.pow(1-t, .8)+.001)*Math.sin(angle), side * (.01 + 1.06*t)];
    }, gold, side < 0);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(.034, 24, 16), eyeMaterial);
    eye.position.set(-1.30, .23, side*.34);
    eye.scale.set(1, .85, .5);
    dolphin.add(eye);
    const mouthPoints = [
      [-2.08, .025, side*.065], [-1.95, .005, side*.11],
      [-1.72, -.005, side*.157], [-1.51, .01, side*.24], [-1.39, .04, side*.30],
    ].map(p => new THREE.Vector3(...p));
    const mouth = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mouthPoints), 36, .006, 8, false), darkGold);
    dolphin.add(mouth);
  }

  // A soft painted contact shadow conveys depth without a visible platform.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const ctx = shadowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128,128,0,128,128,128);
  gradient.addColorStop(0, 'rgba(82,65,38,0.16)');
  gradient.addColorStop(.35, 'rgba(82,65,38,0.09)');
  gradient.addColorStop(1, 'rgba(82,65,38,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0,0,256,256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.6), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI/2;
  shadow.position.set(.1, -1.18, 0);
  scene.add(shadow);

  window.renderFrame = (t) => {
    const phase = t / 3 * Math.PI * 2;
    dolphin.position.y = .10 + .075 * Math.sin(phase);
    dolphin.rotation.set(.03 * Math.sin(phase), -.17 + .17 * Math.sin(phase), -.13 + .035 * Math.cos(phase));
    for (const { mesh, original } of deformable) {
      const position = mesh.geometry.attributes.position;
      for (let i = 0; i < original.length; i += 3) {
        const tailWeight = Math.max(0, (original[i] - .25) / 2);
        position.array[i + 1] = original[i + 1] + .16 * tailWeight*tailWeight * Math.sin(phase - tailWeight*.9);
      }
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    shadow.material.opacity = .87 - .08*Math.sin(phase);
    renderer.render(scene, camera);
  };
  window.renderFrame(0);
  window.sceneReady = true;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:#F6F4EE}canvas{display:block}</style><script type="importmap">{"imports":{"three":"./three.module.js"}}</script></head><body><script type="module">import * as THREE from './three.module.js';import {RoomEnvironment} from './RoomEnvironment.js';window.THREE=THREE;window.RoomEnvironment=RoomEnvironment;(${createScene.toString()})();</script></body></html>`;
await writeFile(join(scratch, 'index.html'), html);
const server = createServer(async (req, res) => {
  try {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'three.module.js', 'three.core.js', 'RoomEnvironment.js'].includes(name)) {
      res.writeHead(404).end(); return;
    }
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : 'text/javascript');
    res.end(await readFile(join(scratch, name)));
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch {
  const globalModules = process.platform === 'win32'
    ? execFileSync(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'root', '-g'], { encoding: 'utf8' }).trim()
    : execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  playwright = require(join(globalModules, '@playwright/cli/node_modules/playwright'));
}
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.sceneReady === true);
  for (let frame = 0; frame < (preview ? 1 : duration * fps); frame++) {
    await page.evaluate(t => window.renderFrame(t), frame / fps);
    await page.screenshot({ path: join(frameDir, `${String(frame).padStart(3, '0')}.png`), animations: 'disabled' });
  }
  console.log(`Preview: ${join(frameDir, '000.png')}`);
  if (!preview) {
    const poster = join(root, 'assets/images/dolphin-loading.png');
    const video = join(root, 'assets/videos/dolphin-loading.mp4');
    await copyFile(join(frameDir, '000.png'), poster);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-framerate', `${fps}`,
      '-i', join(frameDir, '%03d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '22',
      '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-an',
      '-movflags', '+faststart', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', video]);
    console.log(`Created ${poster}\nCreated ${video}`);
  }
} finally {
  await browser?.close();
  server.close();
}
