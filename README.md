# Compras Paraguai - Monitor de Preços

Scraper multi-loja para monitoramento de preços de lojas do Paraguai (Ciudad del Este).

## Lojas Suportadas

| Loja | Slug | Status |
|------|------|--------|
| Shopping China | `shopping-china` | Completo (categorias + paginação) |
| New Zone Importados | `newzone` | Completo |
| Nissei | `nissei` | Genérico + busca |
| CellShop | `cellshop` | Genérico + busca |
| Mega Eletrônicos | `mega-eletronicos` | Genérico + busca |
| Casa Bo | `casa-bo` | Genérico + busca |

## Stack

- Node.js / Express
- PostgreSQL
- Playwright (Chromium headless)
- Cheerio (parsing HTML)
- node-cron (agendamento)
- SPA Dashboard (vanilla JS)

## Setup Rápido

```bash
# Com Docker Compose
docker compose up -d

# Ou manualmente
cp .env.example .env
# Editar .env com sua DATABASE_URL
npm install
npx playwright install chromium
node src/server.js
```

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/stores` | Listar lojas |
| GET | `/api/products` | Buscar produtos (params: store, search, brand, min_price, max_price, sort, page) |
| GET | `/api/products/:id` | Detalhes + histórico de preços |
| GET | `/api/categories` | Categorias (param: store) |
| GET | `/api/brands` | Marcas (param: store) |
| GET | `/api/stats` | Dashboard stats |
| GET | `/api/compare?search=` | Comparar preços entre lojas |
| POST | `/api/scrape/:store` | Executar scraper (ou `all`) |
| GET | `/api/scrape/logs` | Histórico de execuções |

## Deploy no Coolify

1. Criar app com Dockerfile
2. Variáveis de ambiente:
   - `DATABASE_URL` = sua conexão PostgreSQL
   - `PORT` = 3000
   - `CRON_SCHEDULE` = `0 */6 * * *`
3. Porta exposta: 3000

## Adicionar Nova Loja

Editar `src/scrapers/index.js` e adicionar no `STORE_CONFIGS`:

```javascript
'nova-loja': {
  Class: GenericStoreScraper,
  config: {
    baseUrl: 'https://www.novaloja.com',
    searchUrl: 'https://www.novaloja.com/search?q={QUERY}',
    searchTerms: POPULAR_TERMS,
    selectors: {
      productCard: '.product-item',
      productName: '.product-title',
    },
  },
},
```

E inserir na tabela `stores`:
```sql
INSERT INTO stores (slug, name, base_url) VALUES ('nova-loja', 'Nova Loja', 'https://www.novaloja.com');
```
