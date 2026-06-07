# Rich Markdown Fixture

This fixture covers rich markdown rendering.

## Code

```js
const answer = 42;
```

## Table

| Name | Value |
| --- | --- |
| alpha | 1 |

## Link and Quote

> Quoted text for rendering.

[Example](https://example.com)

## Image

![Tiny inline SVG](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%3E%3Crect%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22red%22/%3E%3C/svg%3E)

## Mermaid

```mermaid
graph TD
  A[Start] --> B[Done]
```

## Raw HTML

<script>window.__docPiMarkdownXss = 1</script>
<img src="x" onerror="window.__docPiMarkdownImageXss = 1">
