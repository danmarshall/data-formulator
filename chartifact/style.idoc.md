```css
.group { padding: 20px; background-color: #f8f9fa; border: 2px solid #3498db; border-radius: 8px; margin-bottom: 20px; }
.group h2 { color: #3498db; }
.group h3 { color: #2c3e50; }
#demo { background-color: #e8f5e8; border-color: #28a745; }
#demo h2 { color: #28a745; }
```

::: group {#main}

## CSS Styling
Use CSS to style documents with custom layouts and appearance.
### How CSS Works
- Each group gets a `.group` className automatically
- Each group gets an `#id` based on the groupId
- Style headers, backgrounds, borders, and spacing
- CSS applies to all groups in the document
:::

::: group {#demo}

## Demo Section
This section has `groupId="demo"` so it gets `id="demo"` and can be styled with `#demo`.
Notice this section has a green theme instead of blue, applied via the `#demo` CSS selector.
:::
