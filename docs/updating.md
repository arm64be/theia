# Updating

```bash
# Pull latest code
git pull --ff-only

# Reinstall core (if dependencies changed)
cd theia-core && pip install -e ".[dev]" && cd ..

# Reinstall panel (if dependencies changed)
cd theia-panel && npm install && cd ..

# Regenerate TS types from schema (if schema changed)
cd theia-panel && npm run generate-types && cd ..

# Rebuild everything
make build
```

The installer also supports updates:

```bash
bash install.sh --no-update   # Skip git pull (use local checkout as-is)
```
