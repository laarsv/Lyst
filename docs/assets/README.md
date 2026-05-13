# /docs/assets

Static images referenced from the README and other docs live here.

Expected layout:

```
docs/assets/
├── logo.png                      # 200x200 ish, transparent background
└── screenshots/
    ├── lists.png                 # main shopping list view
    ├── recipe.png                # recipe detail / cook mode
    ├── notes.png                 # markdown notes editor
    └── mobile.png                # mobile portrait of the list view
```

The README links to `/docs/assets/logo.png` and
`/docs/assets/screenshots/*.png`. Drop the actual PNGs in here and they'll
render automatically — no other changes needed.

Use lossless PNG (or compressed via something like `oxipng -o4`) and aim
for ≤ 300 KB per image so the README stays snappy on slow networks.
