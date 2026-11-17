# Relatório — Atividade Avaliativa N3

## Loja API: Docker, Docker Compose e Kubernetes

<br>

| | |
|---|---|
| **Aluno(a):** | ________________________________________________ |
| **Turma:** | ADS — 4º semestre |
| **Disciplina:** | DevOps & Cloud Computing |
| **Professor:** | Marcelo Linck |
| **Instituição:** | UNIFASIPE |
| **Data:** | ____ / ____ / ________ |

<br>

> **Nota de entrega:** os campos da capa permanecem para preenchimento pelo
> aluno. As capturas existentes estão em `evidencias/`, são referenciadas ao
> longo do texto e são listadas no índice da seção 6. Nenhum resultado deste
> relatório foi inventado.

---

## 1. Objetivo

Este trabalho tem como objetivo desenvolver e operar uma aplicação simples
chamada **Loja API**, utilizando Node.js, MySQL e Redis, empacotada em uma
imagem Docker, orquestrada localmente com Docker Compose e implantada em um
cluster Kubernetes de laboratório com um único nó.

A atividade também tem como objetivo praticar operações de DevOps:
construção de imagem, escala de réplicas, atualização de versão, falha
proposital de implantação, rollback, configuração de recursos, escalonamento
automático com HPA, coleta de métricas e verificação de persistência de dados.

---

## 2. Descrição da aplicação

A Loja API é uma API HTTP em Node.js com Express, escutando na porta `3000`.
Ela utiliza:

- **MySQL 8.0** para armazenar os produtos;
- **Redis 7** para armazenar em cache a listagem de produtos;
- **mysql2** para acesso ao MySQL, sem ORM;
- **redis** (cliente oficial) para acesso ao Redis.

### 2.1 Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/` | Retorna mensagem de funcionamento e a versão da API |
| GET | `/health` | Verifica a conexão com MySQL e Redis |
| GET | `/products` | Lista os produtos, usando cache do Redis |

### 2.2 Inicialização

Na primeira execução, a aplicação:

1. aguarda MySQL e Redis ficarem disponíveis (com tentativas e intervalo);
2. cria a tabela `products` com `CREATE TABLE IF NOT EXISTS`;
3. insere dois produtos de exemplo (`Teclado` e `Mouse`) somente se a tabela
   estiver vazia;
4. inicia o servidor HTTP na porta `3000`.

Ao receber `SIGTERM` ou `SIGINT`, a aplicação fecha o servidor HTTP, encerra a
conexão com o Redis e o pool do MySQL antes de terminar o processo.

### 2.3 Configurações

As configurações vêm de variáveis de ambiente: `PORT`, `API_VERSION`,
`CACHE_TTL`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`REDIS_HOST` e `REDIS_PORT`. Nenhuma senha real está no código.

### 2.4 Versão 2.0

O `Dockerfile` aceita o argumento de build `API_VERSION`. A versão é exposta
no campo `version` de `GET /` e no header `X-API-Version`. Assim, a imagem
`loja-api:2.0`, construída com `--build-arg API_VERSION=2.0.0`, apresenta uma
alteração visível em relação à `1.0`.

---

## 3. Desenvolvimento

### 3.1 Parte 1 — Docker

Foi criado um `Dockerfile` baseado em `node:20-alpine` que:

- define `API_VERSION`, `PORT` e `NODE_ENV` com `ARG`/`ENV`;
- copia `package.json` e instala apenas dependências de produção
  (`npm install --omit=dev`);
- copia o código em `src/`;
- cria o grupo e o usuário `appuser`, ajusta permissões e executa como
  usuário não root (`USER appuser`);
- expõe a porta `3000`;
- inicia com `CMD ["node", "src/server.js"]`.

O `.dockerignore` evita enviar `node_modules`, `.git`, `.env`, arquivos
Markdown e outros itens desnecessários para o contexto de build.

Build:

```bash
docker build -t loja-api:1.0 ./app
```

**Evidências existentes — imagem `loja-api:1.0`**

- `evidencias/09-imagem-docker-1.0.png`: saída de `docker images loja-api`, com
  as tags `loja-api:1.0`, `loja-api:1.0.0` e `loja-api:2.0`.
- `evidencias/09.1-imagem-docker-1.0.png`: continuação de
  `docker image inspect loja-api:1.0`, com `Cmd` igual a
  `node src/server.js`, `WorkingDir` `/app` e usuário `appuser`.

### 3.2 Parte 2 — Docker Compose

O `docker-compose.yml` define três serviços na rede interna `loja_net`:

- **api**: construída a partir de `./app`, publicada em `3000:3000`;
- **mysql**: imagem `mysql:8.0`, com volume nomeado `mysql_data` em
  `/var/lib/mysql`;
- **redis**: imagem `redis:7-alpine`.

As variáveis são lidas do arquivo `.env` (criado a partir do `.env.example`).
O MySQL e o Redis possuem **healthchecks**; a API usa `depends_on` com
`condition: service_healthy`, além de um healthcheck próprio que consulta
`/health`. O Compose também possui a lógica de repetição de conexão na própria
aplicação, o que ajuda quando o banco demora a aceitar conexões.

Subida do ambiente:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

**Evidência existente — `docker compose ps`**

- `evidencias/10-docker-compose.png`: `loja-api`, `loja-mysql` e `loja-redis`
  aparecem como `Up ... (healthy)`.

Acesso:

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/products
```

**Evidência existente — respostas da API**

- `evidencias/08-testes-api.png`: `curl -i` para `/health` e `/products`
  retornando `HTTP/1.1 200 OK`. A mesma captura registra uma tentativa de
  port-forward na porta `3000` com falha por porta já ocupada; por isso os
  `curl` foram feitos diretamente em `localhost:3000`.

Persistência: `docker compose down` remove os containers, mas não o volume
nomeado. Ao executar `docker compose up -d` novamente, os produtos continuam
no banco. Para provar isso pela API, é necessário limpar o cache do Redis
antes da consulta, pois ele pode devolver a resposta em cache:

```bash
docker compose down
docker compose up -d
docker compose exec redis redis-cli DEL products:all
curl http://localhost:3000/products
```

**Evidências existentes — persistência no Compose**

- `evidencias/11-produtos-antes-persistencia.png`: `/products` com `Teclado` e
  `Mouse` antes do `down`.
- `evidencias/12-persistencia-docker-compose.png`: `docker compose down`,
  `docker compose up -d` e `/products` com os mesmos produtos depois.
- `evidencias/13-volume-docker.png`: volume `loja-n3_mysql_data` e o mount em
  `/var/lib/mysql` no container `loja-mysql`.

### 3.3 Parte 3 — Kubernetes

Os manifestos ficam em `k8s/` e usam o namespace `n3-gabriel-luiz`.

| Arquivo | Recursos |
|---|---|
| `namespace.yaml` | Namespace da atividade |
| `configmap.yaml` | Configurações não sensíveis (porta, banco, Redis, TTL) |
| `secret.yaml` | Credenciais fictícias do MySQL |
| `mysql.yaml` | PVC, Deployment e Service do MySQL |
| `redis.yaml` | Deployment e Service do Redis |
| `api.yaml` | Deployment (2 réplicas), probes, recursos e Service NodePort |
| `hpa.yaml` | HorizontalPodAutoscaler de 2 a 10 réplicas por CPU |

Detalhes relevantes:

- O Deployment da API usa `readinessProbe` e `startupProbe` em `/health`
  (dependências) e `livenessProbe` em `/` (processo HTTP), para não reiniciar
  a API apenas porque o banco ficou momentaneamente indisponível.
- Os recursos da API são: requests `100m` de CPU e `128Mi` de memória;
  limits `500m` de CPU e `256Mi` de memória.
- O Service da API é `NodePort` na porta `30080` (porta do container `3000`).
- O PVC do MySQL (2Gi, `ReadWriteOnce`) depende de uma StorageClass padrão no
  cluster; o Deployment usa estratégia `Recreate` para evitar dois pods
  montando o mesmo volume `ReadWriteOnce`.
- O MySQL recebe `MYSQL_DATABASE` do ConfigMap e as senhas do Secret. A API
  recebe as configurações não sensíveis via `envFrom` do ConfigMap e apenas
  `DB_USER`/`DB_PASSWORD` do Secret, sem receber a senha de root.

Aplicação:

```bash
export NS=n3-gabriel-luiz
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml \
  -f k8s/secret.yaml \
  -f k8s/mysql.yaml \
  -f k8s/redis.yaml \
  -f k8s/api.yaml
kubectl get all -n "$NS"
```

**Evidências existentes — recursos do Kubernetes**

- `evidencias/01-estado-inicial.png`: `kubectl get all -n n3-gabriel-luiz`, com
  API 2/2, MySQL 1/1, Redis 1/1 e HPA com `cpu: 0%/50%`, 2 réplicas.
- `evidencias/02-pvc-mysql.png`: `kubectl get pvc -n n3-gabriel-luiz`, com
  `mysql-pvc` em `Bound`.

Acesso com port-forward:

```bash
kubectl port-forward -n "$NS" svc/loja-api 3000:3000
curl http://localhost:3000/
```

**Evidência existente — resposta HTTP da API**

- `evidencias/08-testes-api.png`: `/health` e `/products` com `HTTP 200`,
  conforme descrito na Parte 2. A captura não demonstra o port-forward do
  Kubernetes porque a porta local `3000` estava ocupada pelo Compose.

### 3.4 Parte 4 — Operações Kubernetes

As operações foram organizadas em `comandos.md`, na ordem de execução:

1. criação e verificação do namespace;
2. aplicação dos manifestos;
3. verificação de pods, services, PVC, ConfigMap e Secret;
4. escala manual da API de 2 para 4 e de volta para 2;
5. criação da versão 2.0 com alteração visível;
6. build e disponibilização da imagem 2.0 no nó;
7. atualização com `kubectl set image`;
8. acompanhamento com `rollout status` e `rollout history`;
9. aplicação proposital de imagem inexistente;
10. diagnóstico com `kubectl describe pod` (eventos de falha);
11. recuperação com `kubectl rollout undo`;
12. ajuste de requests e limits com `kubectl set resources`;
13. verificação/instalação do metrics-server e criação do HPA pelo manifesto;
14. geração de carga com um Deployment BusyBox;
15. observação do HPA aumentando e diminuindo réplicas;
16. `kubectl top pods`;
17. `kubectl describe node`;
18. prova de persistência do MySQL após apagar seu pod.

As capturas existentes em `evidencias/` registram os passos 1–11 e 14–17; os
registros de terminal desta revisão complementam os passos 12–13, 15, 18 e o
estado final. A associação entre etapas e arquivos é:

| Etapa | Evidência |
|---|---|
| 1–3 | `evidencias/01-estado-inicial.png`, `evidencias/02-pvc-mysql.png` |
| 4 | `evidencias/14-escala-4-replicas.png`, `evidencias/15-escala-2-replicas.png` |
| 5–6 | `evidencias/09-imagem-docker-1.0.png` (tag `2.0`), `evidencias/16-rollout-versao-2.png` |
| 7–8 | `evidencias/16-rollout-versao-2.png`, `evidencias/17-rollout-history.png`, `evidencias/03-rollout-history.png` |
| 9 | `evidencias/18-falha-imagem.png` |
| 10 | `evidencias/19-diagnostico-imagem.png`, `evidencias/19.1-diagnostico-imagem.png` |
| 11 | `evidencias/20-rollout-undo.png` |
| 12 | `evidencias/03.1-rollout-history.png`, `evidencias/19.1-diagnostico-imagem.png` |
| 13 | `evidencias/01-estado-inicial.png` e registros de terminal abaixo |
| 14–15 | registros de terminal abaixo e eventos em `evidencias/03.1-rollout-history.png` |
| 16 | `evidencias/05-06-top-pods.png` e registro sob carga abaixo |
| 17 | `evidencias/07-describe-node.png`, `evidencias/07.1-describe-node.png` |
| 18 | `evidencias/11-produtos-antes-persistencia.png`, `evidencias/12-persistencia-docker-compose.png` e registros do MySQL no Kubernetes abaixo |

**Saídas reais — HPA antes da carga (baseline)**

```text
NAME       REFERENCE             TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
loja-api   Deployment/loja-api   cpu: 1%/50%   2         10        2          84s
```

**Saídas reais — HPA durante a carga (pico)**

```text
NAME       REFERENCE             TARGETS         MINPODS   MAXPODS   REPLICAS   AGE
loja-api   Deployment/loja-api   cpu: 110%/50%   2         10        4          3m23s
NAME       REFERENCE             TARGETS        MINPODS   MAXPODS   REPLICAS   AGE
loja-api   Deployment/loja-api   cpu: 94%/50%   2         10        8          4m57s
```

**Saídas reais — eventos do HPA**

```text
Normal   SuccessfulRescale   New size: 4; reason: cpu resource utilization (percentage of request) above target
Normal   SuccessfulRescale   New size: 8; reason: cpu resource utilization (percentage of request) above target
Normal   SuccessfulRescale   New size: 4; reason: All metrics below target
Normal   SuccessfulRescale   New size: 2; reason: All metrics below target
```

**Saídas reais — `kubectl top pods -n $NS` sob carga**

```text
NAME                         CPU(cores)   MEMORY(bytes)
load-test-8464d5557b-bv4qm   366m         2Mi
load-test-8464d5557b-qgclv   366m         2Mi
load-test-8464d5557b-w4zb6   364m         2Mi
loja-api-688c6ccd45-56488    112m         35Mi
loja-api-688c6ccd45-8xntm    117m         30Mi
loja-api-688c6ccd45-bf8qn    94m          56Mi
loja-api-688c6ccd45-djl6r    103m         30Mi
loja-api-688c6ccd45-dqkhq    124m         31Mi
loja-api-688c6ccd45-dr6mz    120m         31Mi
loja-api-688c6ccd45-tscpd    94m          29Mi
loja-api-688c6ccd45-v2fb2    121m         30Mi
mysql-86779cf6bf-gtk9l       58m          433Mi
redis-5655578f97-hhvl7       50m          22Mi
```

**Saídas reais — `kubectl describe node minikube` (Capacity/Allocatable/Allocated)**

```text
Capacity:
  cpu:                4
  memory:             2973604Ki
  pods:               110
Allocatable:
  cpu:                4
  memory:             2973604Ki
  pods:               110
Allocated resources:
  Resource           Requests      Limits
  --------           --------      ------
  cpu                2600m (65%)   4750m (118%)
  memory             1714Mi (59%)  2858Mi (98%)
```

**Saídas reais — produtos no MySQL antes e depois de apagar o pod**

```text
--- ANTES: produtos no MySQL ---
id  name     price
1   Teclado  120.50
2   Mouse    45.90
3   Teclado  120.50
4   Mouse    45.90

--- DEPOIS: produtos no MySQL ---
id  name     price
1   Teclado  120.50
2   Mouse    45.90
3   Teclado  120.50
4   Mouse    45.90
```

**Saídas reais — estado final**

```text
deployment.apps/loja-api   2/2  2  2
deployment.apps/mysql      1/1  1  1
deployment.apps/redis      1/1  1  1
loja-api   Deployment/loja-api   cpu: 1%/50%  2  10  2
/health   -> HTTP 200  {"api":"ok","mysql":"ok","redis":"ok"}
/products -> HTTP 200  {"source":"mysql","products":[...]}
```

**Ocorrências transitórias observadas**

- `FailedGetResourceMetric` e `FailedComputeMetricsReplicas` enquanto pods
  recém-criados ainda não entregavam métricas ao HPA.
- As readiness probes da API retornaram HTTP 503 durante a recriação do pod do
  MySQL; após a estabilização, `/health` voltou a HTTP 200.
- A tabela `products` terminou a primeira inicialização com 4 linhas, duplicando
  os dois produtos de exemplo, em razão da corrida no `initDb`
  (`app/src/server.js:80`): as duas réplicas da API consultaram `COUNT(*) = 0`
  antes de qualquer insert. Nenhuma ação corretiva foi aplicada.

**Evidências existentes — escala, rollout e HPA**

- `evidencias/14-escala-4-replicas.png`: quatro pods da API em `Running` após
  `kubectl scale ... --replicas=4`.
- `evidencias/15-escala-2-replicas.png`: retorno a dois pods da API em
  `Running`.
- `evidencias/17-rollout-history.png`: três revisões do Deployment.
- `evidencias/20-rollout-undo.png`: estado final com `loja-api:2.0` e dois pods
  `Running` após a recuperação.
- `evidencias/01-estado-inicial.png` e `evidencias/03.1-rollout-history.png`:
  HPA e eventos de escalonamento.

**Evidências existentes — falha proposital**

- `evidencias/18-falha-imagem.png`: novo pod em `ErrImagePull` enquanto os
  antigos permanecem `Running`.
- `evidencias/19-diagnostico-imagem.png` e
  `evidencias/19.1-diagnostico-imagem.png`: `Image: loja-api:inexistente`,
  `Reason: ErrImagePull` e eventos `Failed`, `BackOff` e `ImagePullBackOff`.

**Evidências existentes — métricas e persistência**

- `evidencias/05-06-top-pods.png`: `kubectl top pods` e `kubectl top nodes`.
- `evidencias/07-describe-node.png` e `evidencias/07.1-describe-node.png`:
  seções `Capacity`, `Allocatable` e `Allocated resources`.
- `evidencias/11-produtos-antes-persistencia.png` e
  `evidencias/12-persistencia-docker-compose.png`: produtos antes e depois do
  `down`/`up` no Compose. Os registros de terminal acima cobrem a consulta
  direta ao MySQL no Kubernetes antes e depois de apagar o pod.

### 3.5 Parte 5 — Relatório

Este documento consolida a descrição da aplicação, as decisões de
infraestrutura e as respostas às questões do enunciado. As capturas reais
existentes estão em `evidencias/`, são referenciadas nas seções anteriores e
são listadas no índice da seção 6. O PDF foi gerado a partir deste Markdown com
conversão para HTML e impressão via LibreOffice, preservando capa, seções e as
imagens das evidências.

---

## 4. Respostas às questões

### 4.1 Diferença entre imagem e container e instruções do Dockerfile

Uma **imagem** é um artefato imutável, formado por camadas somente leitura,
que contém o sistema de arquivos, as dependências e a definição de execução da
aplicação. Um **container** é uma instância em execução dessa imagem, com uma
camada gravável própria, processos isolados e configuração de rede/volumes.
Uma mesma imagem pode originar vários containers.

Instruções usadas no projeto:

- `FROM node:20-alpine`: define a imagem base (Node.js 20 em Alpine Linux).
- `ARG API_VERSION` e `ENV ...`: recebem a versão no build e definem variáveis
  de ambiente padrão da imagem.
- `WORKDIR /app`: define o diretório de trabalho.
- `COPY package.json ./` e `RUN npm install --omit=dev`: copiam as dependências
  e instalam apenas o necessário para produção; essa ordem aproveita o cache
  de camadas do Docker quando o código muda, mas as dependências não.
- `COPY src/ ./src/`: copia o código da aplicação.
- `RUN addgroup` / `adduser` / `chown`: criam um usuário sem privilégios.
- `USER appuser`: garante que o processo não rode como root.
- `EXPOSE 3000`: documenta a porta usada pela aplicação.
- `CMD ["node", "src/server.js"]`: define o comando padrão do container.

### 4.2 Como o Kubernetes resolve a espera pela disponibilidade do banco

O Kubernetes não possui um equivalente direto ao `depends_on` do Docker
Compose. A solução adotada combina três mecanismos:

1. **Tentativas na aplicação:** a API tenta conectar ao MySQL e ao Redis por
   várias vezes, com intervalo, antes de iniciar o servidor HTTP.
2. **`readinessProbe`:** o pod da API só é marcado como *Ready* quando
   `GET /health` retorna sucesso, ou seja, quando MySQL e Redis respondem. O
   Service só envia tráfego para pods prontos.
3. **`startupProbe`:** concede tempo para a inicialização antes que a
   `livenessProbe` comece a reiniciar o container. Se o pod falhar, o
   Kubernetes o reinicia com backoff, até que as dependências estejam
   disponíveis.

Como alternativa, poderíamos usar um `initContainer` que aguarda a porta do
MySQL, mas as probes e as tentativas na aplicação já atendem ao objetivo e
evitam enviar tráfego para uma API ainda não pronta.

### 4.3 O que são requests e limits e justificativa dos valores

- **Requests** representam o mínimo reservado para o pod. O scheduler usa esse
  valor para escolher o nó, e o HPA usa o request de CPU como referência de
  utilização.
- **Limits** representam o máximo que o container pode consumir. Ao ultrapassar
  o limite de CPU, o container é limitado (*throttled*); ao ultrapassar o
  limite de memória, pode ser encerrado (*OOMKilled*).

Valores adotados:

| Componente | Requests | Limits | Justificativa |
|---|---|---|---|
| API (manifesto) | 100m CPU / 128Mi | 500m CPU / 256Mi | Aplicação leve, mas com picos durante requisições e inicialização |
| API (após `set resources`) | 200m CPU / 128Mi | 500m CPU / 256Mi | Valor efetivo registrado em `evidencias/03.1-rollout-history.png`, usado como base do HPA |
| MySQL | 100m CPU / 256Mi | 500m CPU / 512Mi | Banco pequeno de laboratório, com folga para consultas |
| Redis | 50m CPU / 64Mi | 250m CPU / 128Mi | Cache simples, com baixo consumo |

Os valores são adequados ao laboratório de um nó. O alvo de 50% do HPA é
calculado sobre o `requests.cpu` da API: aproximadamente 50m por pod com os
100m iniciais do manifesto e 100m por pod após o `kubectl set resources`.

### 4.4 Explicação de Deployment, ReplicaSet e Service

- **Deployment**: recurso declarativo que descreve o estado desejado da
  aplicação (imagem, réplicas, probes, recursos). Ele cria e gerencia
  ReplicaSets e permite atualizações graduais (*rolling update*), histórico de
  revisões e rollback.
- **ReplicaSet**: garante que o número correto de réplicas de um pod esteja em
  execução. Em geral, é criado e gerenciado pelo Deployment, e cada nova
  versão do template gera um novo ReplicaSet.
- **Service**: fornece um nome DNS e um endereço virtual estável para um
  conjunto de pods, selecionados por labels. Ele faz o balanceamento entre os
  pods prontos e desacopla os clientes dos endereços efêmeros dos pods. Neste
  projeto, o Service `mysql` e o `redis` são `ClusterIP`, e o Service
  `loja-api` é `NodePort` para permitir o acesso externo no laboratório.

### 4.5 Por que base64 não é segurança e onde guardar senhas em produção

O Kubernetes armazena os valores de um Secret em base64, mas base64 é apenas
uma codificação reversível, não criptografia. Qualquer pessoa com permissão
para ler o Secret (ou com acesso ao etcd, dependendo da configuração do
cluster) pode decodificar o valor com `base64 -d`. Além disso, um Secret
versionado no Git continua exposto no histórico do repositório.

Neste projeto as credenciais são fictícias e usadas somente em laboratório.
Em produção, as recomendações são:

- usar um gerenciador de segredos (HashiCorp Vault, AWS Secrets Manager,
  Azure Key Vault, Google Secret Manager);
- usar soluções como Sealed Secrets ou External Secrets para integração com
  GitOps;
- habilitar criptografia em repouso no etcd e RBAC restritivo;
- não versionar `.env` nem Secrets com valores reais;
- rotacionar senhas e usar identidades de workload em vez de senhas fixas.

### 4.6 Explicação do HPA e dos resultados do teste

O **HorizontalPodAutoscaler** ajusta o número de réplicas de um Deployment com
base em métricas. Para CPU, o cálculo é aproximadamente:

```text
réplicas desejadas = ceil(réplicas atuais × utilização atual / utilização alvo)
```

O HPA consulta o metrics-server periodicamente. Ele exige que os pods tenham
`requests.cpu` definidos e que a API de métricas (`metrics.k8s.io`) esteja
disponível. Neste projeto, o alvo é 50% de utilização de CPU, com mínimo de 2
e máximo de 10 réplicas.

O teste foi feito com carga real (Deployment BusyBox com 3 réplicas) e os
resultados observados foram:

- métricas iniciais: `cpu: 1%/50%`, 2 réplicas;
- comportamento do HPA durante a carga: subiu de 2 para 4 e depois para 8
  réplicas; pico de CPU observado de `110%/50%`;
- número de réplicas observado: pico de 8 réplicas (o limite configurado é 10);
- tempo aproximado para aumentar: primeira ampliação em cerca de 1 min após o
  início da carga e segunda em cerca de 4 min;
- comportamento após remover a carga: a CPU caiu para `0%/50%` e o HPA reduziu
  de 8 para 4 em aproximadamente 6 min e de 4 para 2 em aproximadamente
  7 min 38 s, com o evento `All metrics below target`;
- estado final: API 2/2, MySQL 1/1, Redis 1/1, HPA em 2 réplicas e endpoints
  `/health` e `/products` respondendo HTTP 200.

Ocorrências transitórias observadas, sem ação corretiva aplicada:

- `FailedGetResourceMetric` e `FailedComputeMetricsReplicas` enquanto pods
  recém-criados ainda não entregavam métricas;
- readiness probes da API retornaram HTTP 503 durante a recriação do pod do
  MySQL;
- duplicidade dos produtos de exemplo na primeira inicialização, decorrente da
  corrida no `initDb` (`app/src/server.js:80`).

> As métricas e as réplicas foram observadas no ambiente antes de afirmar o
> funcionamento do HPA. O metrics-server já estava disponível, com o
> `apiservice v1beta1.metrics.k8s.io` marcado como `True`.

Evidências relacionadas: `evidencias/01-estado-inicial.png`,
`evidencias/03.1-rollout-history.png`, `evidencias/05-06-top-pods.png` e
`evidencias/07-describe-node.png`.

### 4.7 Utilidade do rollout undo e relato da falha proposital

O `kubectl rollout undo` retorna um Deployment a uma revisão anterior,
recriando os pods com a imagem e a configuração daquela revisão. É útil quando
uma atualização introduz falhas e a correção precisa ser rápida, sem editar
manualmente os manifestos. O histórico é mantido pelo Deployment e limitado
por `revisionHistoryLimit`.

No teste registrado, foi aplicada uma imagem inexistente com
`kubectl set image deployment/loja-api api=loja-api:inexistente`. Os novos pods
ficaram em `ErrImagePull`/`ImagePullBackOff`, enquanto os antigos permaneceram
`Running`, como esperado para a estratégia `RollingUpdate` com
`maxUnavailable: 0`.

**Evidências existentes:**

- `evidencias/18-falha-imagem.png`: pods antigos `Running` e novo pod em
  `ErrImagePull`.
- `evidencias/19-diagnostico-imagem.png` e
  `evidencias/19.1-diagnostico-imagem.png`: `Image: loja-api:inexistente`,
  `Reason: ErrImagePull`, `Failed to pull image`, `Back-off pulling image` e
  `ImagePullBackOff`.
- `evidencias/20-rollout-undo.png`: estado final com `loja-api:2.0`, dois pods
  `Running` e Deployment `2/2`, após a recuperação.

A captura `20-rollout-undo.png` registra o estado posterior à recuperação; o
texto do comando `kubectl rollout undo` não aparece na saída visível da imagem.

### 4.8 Limitações da solução e melhorias para produção

Limitações atuais:

- cluster de laboratório com um único nó, sem alta disponibilidade;
- MySQL e Redis com uma única réplica e sem replicação;
- API sem autenticação, autorização e HTTPS;
- senhas de exemplo no Secret, sem gerenciador de segredos;
- criação da tabela na inicialização, sem migrations versionadas;
- HPA baseado apenas em CPU, sem métricas de negócio;
- imagem carregada manualmente no nó, sem registry;
- ausência de backups, políticas de rede e observabilidade centralizada;
- PVC dependente da StorageClass do laboratório, sem classe de armazenamento
  configurada explicitamente para produção.

Melhorias para produção:

- usar MySQL gerenciado ou operador com réplicas e backups automáticos;
- usar Redis com persistência e alta disponibilidade;
- adotar Ingress com TLS e autenticação;
- usar registry de imagens com versionamento imutável;
- integrar Vault/External Secrets e RBAC;
- adicionar migrations, testes automatizados e pipeline CI/CD;
- configurar requests/limits com base em medições reais;
- adicionar métricas, logs centralizados, alertas e tracing (Prometheus,
  Grafana, Loki);
- aplicar NetworkPolicies e PodDisruptionBudgets;
- usar múltiplos nós e políticas de afinidade/anti-afinidade para resiliência.

---

## 5. Conclusão

O projeto entregou uma aplicação simples e funcional, com persistência em
MySQL, cache em Redis, imagem Docker executada por usuário não root,
orquestração com Docker Compose e manifestos Kubernetes para deploy em um nó
único. O roteiro de operações permite demonstrar escala, atualização, falha
proposital, rollback, recursos, HPA e persistência de dados.

As evidências reais de execução estão organizadas em `evidencias/` e são
referenciadas neste relatório. Limitações foram identificadas e melhorias foram
propostas, deixando claro que a solução atende ao laboratório, mas não substitui
uma arquitetura de produção.

---

## 6. Checklist de evidências

| # | Evidência | Obtida? |
|---|---|---|
| 1 | Build/imagem `loja-api:1.0` | ☑ |
| 2 | `docker compose ps` com serviços saudáveis | ☑ |
| 3 | Respostas de `/`, `/health`, `/products` | ☑ |
| 4 | Persistência após `docker compose down` e `up` | ☑ |
| 5 | `kubectl get all` no namespace | ☑ |
| 6 | PVC do MySQL `Bound` | ☑ |
| 7 | Escala 2 → 4 → 2 | ☑ |
| 8 | Build/rollout da versão 2.0 | ☑ |
| 9 | Falha proposital e eventos do `describe pod` | ☑ |
| 10 | `rollout undo` concluído | ☑ |
| 11 | `kubectl set resources` aplicado | ☑ |
| 12 | Metrics-server e HPA funcionando | ☑ |
| 13 | Carga com BusyBox e variação de réplicas | ☑ |
| 14 | `kubectl top pods` | ☑ |
| 15 | `kubectl describe node` | ☑ |
| 16 | Dados do MySQL antes e depois de apagar o pod | ☑ |

Os itens marcados correspondem às capturas listadas abaixo e aos registros de
terminal transcritos nas seções anteriores. Nenhuma nova captura foi feita.

### 6.1 Índice de evidências existentes

**`evidencias/01-estado-inicial.png`** — `kubectl get all` no namespace e HPA com `cpu: 0%/50%`, 2 réplicas.

![Estado inicial no Kubernetes](evidencias/01-estado-inicial.png)

**`evidencias/02-pvc-mysql.png`** — PVC `mysql-pvc` em `Bound`.

![PVC do MySQL Bound](evidencias/02-pvc-mysql.png)

**`evidencias/03-rollout-history.png`** — `kubectl rollout history` e início do `describe deployment`.

![Rollout history e describe deployment](evidencias/03-rollout-history.png)

**`evidencias/03.1-rollout-history.png`** — continuação do `describe deployment`, com requests de 200m e eventos de escalonamento.

![Detalhes do Deployment e eventos](evidencias/03.1-rollout-history.png)

**`evidencias/05-06-top-pods.png`** — `kubectl top pods` e `kubectl top nodes`.

![Top pods e top nodes](evidencias/05-06-top-pods.png)

**`evidencias/07-describe-node.png`** — `kubectl describe node minikube`, com `Capacity` e `Allocatable`.

![Describe node - parte 1](evidencias/07-describe-node.png)

**`evidencias/07.1-describe-node.png`** — continuação do `describe node`, com pods e `Allocated resources`.

![Describe node - parte 2](evidencias/07.1-describe-node.png)

**`evidencias/08-testes-api.png`** — `/health` e `/products` com HTTP 200; port-forward em 3000 falhou por porta ocupada.

![Testes HTTP da API](evidencias/08-testes-api.png)

**`evidencias/09-imagem-docker-1.0.png`** — `docker images loja-api`, incluindo as tags `1.0`, `1.0.0` e `2.0`.

![Imagens Docker da API](evidencias/09-imagem-docker-1.0.png)

**`evidencias/09.1-imagem-docker-1.0.png`** — continuação do `docker image inspect loja-api:1.0`.

![Inspect da imagem 1.0](evidencias/09.1-imagem-docker-1.0.png)

**`evidencias/10-docker-compose.png`** — `docker compose ps` com os três serviços `healthy`.

![Docker Compose ps](evidencias/10-docker-compose.png)

**`evidencias/11-produtos-antes-persistencia.png`** — `/products` antes do teste de persistência no Compose.

![Produtos antes da persistência](evidencias/11-produtos-antes-persistencia.png)

**`evidencias/12-persistencia-docker-compose.png`** — `down`, `up` e `/products` com os mesmos produtos.

![Persistência no Docker Compose](evidencias/12-persistencia-docker-compose.png)

**`evidencias/13-volume-docker.png`** — volume `loja-n3_mysql_data` e mount em `/var/lib/mysql`.

![Volume do MySQL no Docker](evidencias/13-volume-docker.png)

**`evidencias/14-escala-4-replicas.png`** — escala manual para 4 réplicas da API.

![Escala para 4 réplicas](evidencias/14-escala-4-replicas.png)

**`evidencias/15-escala-2-replicas.png`** — retorno para 2 réplicas da API.

![Escala para 2 réplicas](evidencias/15-escala-2-replicas.png)

**`evidencias/16-rollout-versao-2.png`** — `set image` para `loja-api:2.0` e rollout concluído.

![Rollout da versão 2.0](evidencias/16-rollout-versao-2.png)

**`evidencias/17-rollout-history.png`** — três revisões do Deployment.

![Rollout history com três revisões](evidencias/17-rollout-history.png)

**`evidencias/18-falha-imagem.png`** — novo pod em `ErrImagePull` durante a falha proposital.

![Falha proposital da imagem](evidencias/18-falha-imagem.png)

**`evidencias/19-diagnostico-imagem.png`** — `describe pod` do pod com imagem inexistente.

![Diagnóstico do pod com falha](evidencias/19-diagnostico-imagem.png)

**`evidencias/19.1-diagnostico-imagem.png`** — eventos `Failed`, `BackOff` e `ImagePullBackOff`.

![Eventos do pod com falha](evidencias/19.1-diagnostico-imagem.png)

**`evidencias/20-rollout-undo.png`** — estado final após a recuperação, com `loja-api:2.0` e 2 pods `Running`.

![Estado após rollout undo](evidencias/20-rollout-undo.png)
