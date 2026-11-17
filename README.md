# Loja API — Atividade N3 (DevOps & Cloud Computing)

Aplicação simples de loja para demonstrar, na prática, uma API Node.js com
MySQL e Redis executada com **Docker**, **Docker Compose** e **Kubernetes**.

## Objetivo

Demonstrar o ciclo básico de uma aplicação conteinerizada:

- API HTTP em Node.js/Express.
- Persistência em MySQL.
- Cache em Redis.
- Build de imagem com Docker.
- Orquestração local com Docker Compose.
- Deploy, escala, atualização, rollback e HPA no Kubernetes.

## Tecnologias

- Node.js 20 + Express
- mysql2 (sem ORM)
- redis (cliente Node.js)
- MySQL 8.0
- Redis 7
- Docker e Docker Compose
- Kubernetes (Deployment, Service, PVC, ConfigMap, Secret, HPA)

## Estrutura de pastas

```text
loja-n3/
├── app/
│   ├── src/
│   │   └── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── docker-compose.yml
├── .env.example
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── mysql.yaml
│   ├── redis.yaml
│   ├── api.yaml
│   └── hpa.yaml
├── .gitignore
├── comandos.md
├── RELATORIO.md
└── README.md
```

> O arquivo `.env` é criado localmente a partir do `.env.example` e não deve
> ser versionado com credenciais reais.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Mensagem de funcionamento e versão da API |
| GET | `/health` | Estado da API, MySQL e Redis |
| GET | `/products` | Produtos do MySQL com cache no Redis |

Na primeira inicialização a API cria a tabela `products` e insere dois
produtos de exemplo caso a tabela esteja vazia.

## Variáveis de ambiente

Copie o exemplo e ajuste se desejar (os valores são fictícios):

```bash
cd ~/Projetos/loja-n3
cp .env.example .env
```

Conteúdo:

| Variável | Uso |
|---|---|
| `MYSQL_ROOT_PASSWORD` | Senha fictícia do root do MySQL |
| `MYSQL_DATABASE` | Nome do banco (`lojadb`) |
| `MYSQL_USER` | Usuário da aplicação |
| `MYSQL_PASSWORD` | Senha fictícia do usuário |
| `API_VERSION` | Versão usada no build do Compose |
| `CACHE_TTL` | Tempo de cache dos produtos, em segundos |

A API recebe `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`REDIS_HOST`, `REDIS_PORT`, `PORT`, `API_VERSION` e `CACHE_TTL`. O Compose
mapeia os valores do `.env` para esses nomes. No Kubernetes, o ConfigMap e o
Secret fazem esse papel.

## Executar com Docker Compose

```bash
cd ~/Projetos/loja-n3
cp .env.example .env          # apenas se o .env ainda não existir
docker compose up -d --build
docker compose ps
```

Verificar saúde e logs:

```bash
docker compose ps
docker compose logs -f api
```

Acessar:

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/products
```

A primeira chamada a `/products` responde com `"source": "mysql"`; as
seguintes podem responder com `"source": "cache"` até o TTL expirar.

Parar sem apagar os dados:

```bash
docker compose down
```

O volume nomeado `mysql_data` mantém os dados. Só use `docker compose down -v`
se quiser apagar o banco de propósito.

Subir novamente e conferir a persistência:

```bash
docker compose up -d
docker compose exec redis redis-cli DEL products:all
curl http://localhost:3000/products
```

## Build manual da imagem

```bash
docker build -t loja-api:1.0 ./app
```

Versão 2.0 com alteração visível (campo `version` e header `X-API-Version`):

```bash
docker build --build-arg API_VERSION=2.0.0 -t loja-api:2.0 ./app
```

## Executar no Kubernetes

Pré-requisitos: cluster acessível pelo `kubectl` e imagem disponível no nó.

1. Confirme o namespace `n3-gabriel-luiz` nos arquivos de `k8s/`:

```bash
export NS=n3-gabriel-luiz
```

2. Construa e carregue a imagem no nó:

```bash
docker build -t loja-api:1.0 ./app
kind load docker-image loja-api:1.0        # kind
# minikube image load loja-api:1.0         # minikube
# docker save loja-api:1.0 | sudo k3s ctr images import -   # k3s
```

3. Crie o namespace e aplique os manifestos:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml \
  -f k8s/secret.yaml \
  -f k8s/mysql.yaml \
  -f k8s/redis.yaml \
  -f k8s/api.yaml
```

4. Verifique os recursos:

```bash
kubectl get all -n "$NS"
kubectl get pvc,configmap,secret -n "$NS"
kubectl get pods -n "$NS" -w
```

5. Acesse a API:

```bash
kubectl port-forward -n "$NS" svc/loja-api 3000:3000
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/products
```

O Service também é do tipo `NodePort` na porta `30080`:

```bash
kubectl get nodes -o wide
curl http://<IP_DO_NO>:30080/
```

6. Recursos e diagnóstico:

```bash
kubectl describe deployment loja-api -n "$NS"
kubectl logs -n "$NS" deployment/loja-api
kubectl get hpa -n "$NS"      # após criar o HPA conforme comandos.md
kubectl top pods -n "$NS"      # requer metrics-server
kubectl describe node <NOME_DO_NO>
```

O roteiro completo, incluindo escala, versão 2.0, falha proposital, rollback,
HPA, carga com BusyBox e prova de persistência do MySQL, está em
[`comandos.md`](comandos.md).

### Observações importantes do Kubernetes

- O PVC do MySQL exige uma **StorageClass padrão**; veja `kubectl get sc`.
- O HPA e o `kubectl top` exigem **metrics-server**; veja o passo 13 de
  `comandos.md`.
- No Kubernetes a versão exibida pela API vem da **imagem** (build arg
  `API_VERSION`), e não do ConfigMap, para que `kubectl set image` produza
  uma alteração visível.
- A senha do Secret é apenas fictícia. Base64 não é criptografia; em produção
  use um gerenciador de segredos (Sealed Secrets, External Secrets, Vault etc.).

## Testes rápidos

```bash
# API no ar
curl -s http://localhost:3000/

# Dependências
curl -s http://localhost:3000/health

# MySQL/Redis
docker compose exec mysql sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD"'
docker compose exec redis redis-cli ping

# Produtos e cache
curl -s http://localhost:3000/products
curl -s http://localhost:3000/products

# Encerramento gracioso
docker compose stop api
docker compose logs api --tail=5
docker compose start api
```

## Limitações

- Solução de laboratório: um único nó, sem alta disponibilidade real.
- MySQL e Redis com uma réplica e sem replicação.
- Sem autenticação nas rotas da API.
- Sem migrations; a tabela é criada na inicialização.
- Métricas e logs não são enviados para uma plataforma de observabilidade.
- Para produção: múltiplas réplicas com banco gerenciado, backups, TLS,
  Ingress, gerenciador de segredos, limites mais refinados e observabilidade.
