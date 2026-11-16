# Iris React 接入（建议独立 PR，不改冻结 ui）

## 资源映射
把三个 1024 PNG 图标放在 `web/public/brand/`，并在 `Wordmark.tsx` 里统一引用：

```tsx
<span className="wordmark__iris" aria-hidden="true">
  <img className="wordmark__mark wordmark__mark--light"
       src="/brand/iris-optical-primary-1024.png" alt="" width={32} height={32} />
  <img className="wordmark__mark wordmark__mark--dark"
       src="/brand/iris-optical-dark-1024.png" alt="" width={32} height={32} />
</span>
<span className="wordmark__zh" style={{ fontFamily: 'var(--font-brand)', fontWeight: 700 }}>
  Iris
</span>
```

管理端 `AdminNav.tsx` 不应再画一枚不同轮廓的 `IrisMark`；改为引用 `iris-optical-admin-purple-1024.png`。

更新 `web/index.html` Favicon 路径指向 `/brand/iris-favicon.ico`。

先完成 UI 解冻授权或独立 PR 评审，**不要直接修改 `ui` / `master`**。

## 必做回归

- Light/Dark 顶栏与登录、页脚、管理员侧栏、favicon。
- 16/24/32/48px 实际浏览器与 1x/2x DPR 清晰度。
- 24px 缩放小图不使用自动锐化；必要时单独测试尺寸优化，但保持统一外轮廓。
- 灰阶、单色背景、浏览器遮蔽标签场景。
