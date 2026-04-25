<script setup lang="ts">
import * as THREE from 'three'
import { onMounted, onUnmounted, ref, watch, useTemplateRef } from 'vue'

interface GridDistortionProps {
  grid?: number
  mouse?: number
  strength?: number
  relaxation?: number
  imageSrc: string
  className?: string
}

const props = withDefaults(defineProps<GridDistortionProps>(), {
  grid: 15,
  mouse: 0.1,
  strength: 0.15,
  relaxation: 0.9,
  className: '',
})

const vertexShader = `
uniform float time;
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
uniform sampler2D uDataTexture;
uniform sampler2D uTexture;
uniform vec4 resolution;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec4 offset = texture2D(uDataTexture, vUv);
  gl_FragColor = texture2D(uTexture, uv - 0.02 * offset.rg);
}
`

const containerRef = useTemplateRef<HTMLDivElement>('containerRef')
const imageAspectRef = ref(1)
const cameraRef = ref<THREE.OrthographicCamera | null>(null)
const initialDataRef = ref<Float32Array | null>(null)

let cleanupAnimation: () => void = () => {}

const setupAnimation = () => {
  const container = containerRef.value
  if (!container) return

  const scene = new THREE.Scene()
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  const camera = new THREE.OrthographicCamera(0, 0, 0, 0, -1000, 1000)
  camera.position.z = 2
  cameraRef.value = camera

  const uniforms = {
    time: { value: 0 },
    resolution: { value: new THREE.Vector4() },
    uTexture: { value: null as THREE.Texture | null },
    uDataTexture: { value: null as THREE.DataTexture | null },
  }

  const textureLoader = new THREE.TextureLoader()
  textureLoader.load(props.imageSrc, (texture) => {
    texture.minFilter = THREE.LinearFilter
    imageAspectRef.value = texture.image.width / texture.image.height
    uniforms.uTexture.value = texture
    handleResize()
  })

  const size = props.grid
  const data = new Float32Array(4 * size * size)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.random() * 255 - 125
    data[i * 4 + 1] = Math.random() * 255 - 125
  }
  initialDataRef.value = new Float32Array(data)

  const dataTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  dataTexture.needsUpdate = true
  uniforms.uDataTexture.value = dataTexture

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader,
    fragmentShader,
  })
  const geometry = new THREE.PlaneGeometry(1, 1, size - 1, size - 1)
  const plane = new THREE.Mesh(geometry, material)
  scene.add(plane)

  const handleResize = () => {
    const width = container.offsetWidth
    const height = container.offsetHeight
    const containerAspect = width / height
    const imageAspect = imageAspectRef.value

    renderer.setSize(width, height)

    const scale = Math.max(containerAspect / imageAspect, 1)
    plane.scale.set(imageAspect * scale, scale, 1)

    const frustumHeight = 1
    const frustumWidth = frustumHeight * containerAspect
    camera.left = -frustumWidth / 2
    camera.right = frustumWidth / 2
    camera.top = frustumHeight / 2
    camera.bottom = -frustumHeight / 2
    camera.updateProjectionMatrix()

    uniforms.resolution.value.set(width, height, 1, 1)
  }

  const mouseState = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vX: 0,
    vY: 0,
  }

  const handleMouseMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = 1 - (e.clientY - rect.top) / rect.height
    mouseState.vX = x - mouseState.prevX
    mouseState.vY = y - mouseState.prevY
    Object.assign(mouseState, { x, y, prevX: x, prevY: y })
  }

  const handleMouseLeave = () => {
    dataTexture.needsUpdate = true
    Object.assign(mouseState, {
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vX: 0,
      vY: 0,
    })
  }

  container.addEventListener('mousemove', handleMouseMove)
  container.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('resize', handleResize)
  handleResize()

  const resizeObserver = new ResizeObserver(() => {
    handleResize()
  })
  resizeObserver.observe(container)

  const animate = () => {
    requestAnimationFrame(animate)
    uniforms.time.value += 0.05

    const data = dataTexture.image.data as Float32Array
    for (let i = 0; i < size * size; i++) {
      data[i * 4] *= props.relaxation
      data[i * 4 + 1] *= props.relaxation
    }

    const gridMouseX = size * mouseState.x
    const gridMouseY = size * mouseState.y
    const maxDist = size * props.mouse

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const distSq = Math.pow(gridMouseX - i, 2) + Math.pow(gridMouseY - j, 2)
        if (distSq < maxDist * maxDist) {
          const index = 4 * (i + size * j)
          const power = Math.min(maxDist / Math.sqrt(distSq), 10)
          data[index] += props.strength * 100 * mouseState.vX * power
          data[index + 1] -= props.strength * 100 * mouseState.vY * power
        }
      }
    }

    dataTexture.needsUpdate = true
    renderer.render(scene, camera)
  }
  animate()

  cleanupAnimation = () => {
    container.removeEventListener('mousemove', handleMouseMove)
    container.removeEventListener('mouseleave', handleMouseLeave)
    window.removeEventListener('resize', handleResize)
    resizeObserver.disconnect()
    renderer.dispose()
    geometry.dispose()
    material.dispose()
    dataTexture.dispose()
    if (uniforms.uTexture.value) uniforms.uTexture.value.dispose()
  }
}

onMounted(() => {
  cleanupAnimation()
  setupAnimation()
})

onUnmounted(() => {
  const container = containerRef.value
  if (container) {
    container.innerHTML = ''
  }
  cleanupAnimation()
})

watch(
  () => props,
  () => {
    cleanupAnimation()
    if (containerRef.value) {
      setupAnimation()
    }
  },
)

defineOptions({
  name: 'GridDistortion',
})
</script>

<template>
  <div ref="containerRef" :class="[props.className, 'grid-distortion-container']" />
</template>

<style scoped>
.grid-distortion-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
