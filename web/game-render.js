import {
    OrthographicCamera,
    Scene,
    WebGLRenderTarget,
    LinearFilter,
    NearestFilter,
    RGBAFormat,
    UnsignedByteType,
    CfxTexture,
    ShaderMaterial,
    PlaneBufferGeometry,
    Mesh,
    WebGLRenderer
} from '/module/Three.js';

class GameRender {
    constructor() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new WebGLRenderer();
        this.renderer.setSize(width, height);
        this.renderer.autoClear = false;
        this.targetWidth = width;
        this.targetHeight = height;
        this.readBuffer = new Uint8Array(width * height * 4);

        const holder = document.createElement('div');
        holder.style.display = 'none';
        holder.appendChild(this.renderer.domElement);
        document.body.appendChild(holder);

        const texture = new CfxTexture();
        texture.needsUpdate = true;
        const material = new ShaderMaterial({
            uniforms: { tDiffuse: { value: texture } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv=vec2(uv.x,1.0-uv.y); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
            fragmentShader: 'varying vec2 vUv; uniform sampler2D tDiffuse; void main(){ gl_FragColor=texture2D(tDiffuse,vUv); }'
        });

        this.material = material;
        this.resize(width, height);
        requestAnimationFrame(() => this.render());
    }

    resize(width, height) {
        this.targetWidth = width;
        this.targetHeight = height;
        this.camera = new OrthographicCamera(width / -2, width / 2, height / 2, height / -2, -10000, 10000);
        this.scene = new Scene();
        const mesh = new Mesh(new PlaneBufferGeometry(width, height), this.material);
        mesh.position.z = -100;
        this.scene.add(mesh);
        this.target = new WebGLRenderTarget(width, height, {
            minFilter: LinearFilter,
            magFilter: NearestFilter,
            format: RGBAFormat,
            type: UnsignedByteType
        });
        this.renderer.setSize(width, height);
        this.readBuffer = new Uint8Array(width * height * 4);
    }

    renderToTarget(canvas, width, height) {
        if (width !== this.targetWidth || height !== this.targetHeight) this.resize(width, height);
        this.canvas = canvas;
        canvas.width = width;
        canvas.height = height;
    }

    render() {
        requestAnimationFrame(() => this.render());
        if (!this.canvas) return;

        this.renderer.clear();
        this.renderer.render(this.scene, this.camera, this.target, true);
        this.renderer.readRenderTargetPixels(this.target, 0, 0, this.targetWidth, this.targetHeight, this.readBuffer);
        const context = this.canvas.getContext('2d', { alpha: false });
        context.putImageData(new ImageData(new Uint8ClampedArray(this.readBuffer.buffer), this.targetWidth, this.targetHeight), 0, 0);
    }
}

window.GameRenderReady = Promise.resolve(new GameRender());
