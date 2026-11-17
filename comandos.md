# Comandos Kubernetes — Loja API (N3)

Sequência de comandos para executar e demonstrar a atividade em um cluster
Kubernetes de laboratório com **um único nó**.

Os resultados abaixo **não foram inventados**: execute cada comando no seu
ambiente e registre as saídas reais para o relatório.

---

## 0. Preparação

### 0.1 Confirmar o namespace

O namespace `n3-gabriel-luiz` já está configurado nos arquivos da pasta `k8s/`.
O nome é minúsculo, sem espaços e sem acentos (padrão DNS).

```bash
cd ~/Projetos/loja-n3
export NS=n3-gabriel-luiz
```

### 0.2 Construir a imagem da API

```bash
cd ~/Projetos/loja-n3
docker build -t loja-api:1.0 ./app
```

A imagem precisa estar disponível no nó do Kubernetes. Use o comando do seu
cluster:

```bash
# kind
kind load docker-image loja-api:1.0

# minikube
minikube image load loja-api:1.0

# k3d
k3d image import loja-api:1.0 -c <nome-do-cluster>

# Cluster com containerd e acesso root (ex.: k3s)
docker save loja-api:1.0 | sudo k3s ctr images import -
```

> Sem carregar a imagem, os pods ficam em `ImagePullBackOff`. O manifesto usa
> `imagePullPolicy: IfNotPresent` justamente para aproveitar a imagem local.

### 0.3 Verificar dependências do cluster

```bash
kubectl version --client
kubectl get nodes
kubectl get storageclass
```

- Precisa existir uma **StorageClass padrão** para o PVC do MySQL sair de
  `Pending`. k3s (local-path), minikube (`standard`) e kind (`standard`)
  normalmente já possuem uma.
- O **metrics-server** é necessário apenas para o HPA e para `kubectl top`.
  Ele é verificado no passo 13.

---

## 1. Criar e verificar o namespace

```bash
kubectl apply -f k8s/namespace.yaml
kubectl get namespaces
kubectl get namespace "$NS"
```

> O namespace é criado primeiro porque os manifestos seguintes são namespaced.
> Sem ele, a aplicação falha com `namespaces "<nome>" not found`.

---

## 2. Aplicar os manifestos

```bash
kubectl apply -f k8s/configmap.yaml \
  -f k8s/secret.yaml \
  -f k8s/mysql.yaml \
  -f k8s/redis.yaml \
  -f k8s/api.yaml
```

> Se o cluster for novo, o passo 1 já criou o namespace. Agora são aplicados
> ConfigMap, Secret, MySQL, Redis e API. O HPA será criado no passo 13,
> depois da escala manual e do `kubectl set resources`.

---

## 3. Verificar os recursos

```bash
kubectl get all -n "$NS"
kubectl get configmap,secret,pvc -n "$NS"
kubectl get pods -n "$NS" -o wide
kubectl get svc -n "$NS"
```

Acompanhar a inicialização:

```bash
kubectl get pods -n "$NS" -w
```

Ver logs e detalhes:

```bash
kubectl logs -n "$NS" deployment/loja-api
kubectl describe deployment loja-api -n "$NS"
kubectl describe pod -n "$NS" -l app=mysql
```

Se o PVC ficar em `Pending`:

```bash
kubectl describe pvc mysql-pvc -n "$NS"
kubectl get storageclass
```

Se não houver StorageClass padrão, instale um provisionador para o seu cluster
(local-path-provisioner, por exemplo) ou, apenas em laboratório, crie um PV
`hostPath` e aplique antes do MySQL:

```yaml
# mysql-pv.yaml - SOMENTE para laboratório de nó único
apiVersion: v1
kind: PersistentVolume
metadata:
  name: mysql-pv
spec:
  capacity:
    storage: 2Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /tmp/loja-mysql
    type: DirectoryOrCreate
```

```bash
kubectl apply -f mysql-pv.yaml
kubectl get pv,pvc -n "$NS"
```

### Acessar a API

Opção recomendada (funciona em qualquer cluster):

```bash
kubectl port-forward -n "$NS" svc/loja-api 3000:3000
```

Em outro terminal:

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/products
```

Opção pelo NodePort criado no Service:

```bash
kubectl get nodes -o wide
curl http://<IP_DO_NO>:30080/
```

> Em clusters kind, o NodePort pode não estar exposto na máquina host. Nesse
> caso use `kubectl port-forward` ou configure `extraPortMappings`.
> No minikube: `minikube service loja-api -n "$NS" --url`.

---

## 4. Escalar a API de 2 para 4 réplicas e voltar para 2

```bash
kubectl get deployment loja-api -n "$NS"
kubectl scale deployment loja-api -n "$NS" --replicas=4
kubectl get pods -n "$NS" -l app=loja-api -w
```

Depois de observar os 4 pods:

```bash
kubectl scale deployment loja-api -n "$NS" --replicas=2
kubectl get deployment loja-api -n "$NS"
```

> Nesta etapa o HPA ainda não foi criado; ele será aplicado no passo 13.
> Assim a escala manual acontece sem interferência do autoscaling.

---

## 5. Criar a versão 2.0 da API com alteração visível

A alteração visível é o campo `version` em `GET /` e o header
`X-API-Version`. A versão vem do build da imagem:

```bash
# O Dockerfile recebe API_VERSION como build arg e define a variável de ambiente.
docker build --build-arg API_VERSION=2.0.0 -t loja-api:2.0 ./app
```

---

## 6. Disponibilizar a imagem 2.0 no nó

Sem imagem no nó, o rollout não termina. Use o comando do seu cluster:

```bash
kind load docker-image loja-api:2.0
# ou
minikube image load loja-api:2.0
# ou
docker save loja-api:2.0 | sudo k3s ctr images import -
```

---

## 7. Atualizar usando `kubectl set image`

```bash
kubectl set image deployment/loja-api api=loja-api:2.0 -n "$NS"
kubectl get pods -n "$NS" -l app=loja-api -w
```

Verificar a alteração visível (com o port-forward ativo):

```bash
curl -i http://localhost:3000/
```

---

## 8. Acompanhar rollout status e rollout history

```bash
kubectl rollout status deployment/loja-api -n "$NS"
kubectl rollout history deployment/loja-api -n "$NS"
kubectl rollout history deployment/loja-api -n "$NS" --revision=<NUMERO>
```

---

## 9. Aplicar propositalmente uma imagem inexistente

```bash
kubectl set image deployment/loja-api api=loja-api:nao-existe -n "$NS"
kubectl get pods -n "$NS" -l app=loja-api -w
```

Os pods novos devem ficar em `ImagePullBackOff`/`ErrImagePull`. Como o
Deployment usa `maxUnavailable: 0`, os pods antigos continuam atendendo.

---

## 10. Diagnosticar o problema com `kubectl describe pod`

Descubra o nome do pod problemático:

```bash
kubectl get pods -n "$NS" -l app=loja-api
kubectl describe pod <NOME_DO_POD_NOVO> -n "$NS"
```

Na seção **Events**, procure mensagens de falha ao baixar a imagem.
Os logs também ajudam:

```bash
kubectl logs <NOME_DO_POD_NOVO> -n "$NS"
kubectl get events -n "$NS" --sort-by=.lastTimestamp
```

---

## 11. Recuperar a versão anterior com `kubectl rollout undo`

```bash
kubectl rollout undo deployment/loja-api -n "$NS"
kubectl rollout status deployment/loja-api -n "$NS"
kubectl get deployment loja-api -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

---

## 12. Configurar requests e limits com `kubectl set resources`

```bash
kubectl set resources deployment/loja-api -n "$NS" \
  --requests=cpu=200m,memory=128Mi \
  --limits=cpu=500m,memory=256Mi
kubectl describe deployment loja-api -n "$NS" | grep -A6 "Limits\|Requests"
```

> O valor de `requests.cpu` é a referência do HPA. Após este comando,
> `requests.cpu` passa a ser 200m; com alvo de 50%, o HPA reage quando o
> consumo médio ultrapassa 100m por pod. Ajuste os valores conforme a
> capacidade do seu laboratório.

---

## 13. Criar o HPA (e instalar o metrics-server, se necessário)

O HPA ainda não foi aplicado. Aplique o manifesto `k8s/hpa.yaml` (mínimo 2,
máximo 10, CPU 50%) neste ponto do roteiro:

```bash
kubectl apply -f k8s/hpa.yaml
```

Verifique se o metrics-server está disponível:

```bash
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
kubectl top pods -n "$NS"
```

Se os comandos falharem com `Metrics API not available`, instale o
metrics-server conforme o seu cluster:

```bash
# minikube
minikube addons enable metrics-server

# kind / cluster genérico
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Em laboratório com certificados autoassinados, pode ser necessário:
kubectl patch deployment metrics-server -n kube-system --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

Aguarde e confirme:

```bash
kubectl rollout status deployment/metrics-server -n kube-system
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
```

Ver o HPA criado pelo manifesto:

```bash
kubectl get hpa -n "$NS"
kubectl describe hpa loja-api -n "$NS"
```

Para praticar o comando `kubectl autoscale`, remova o HPA atual e recrie-o
pelo comando (o nome e os parâmetros são os mesmos do manifesto):

```bash
kubectl delete hpa loja-api -n "$NS"
kubectl autoscale deployment loja-api -n "$NS" --cpu-percent=50 --min=2 --max=10
kubectl get hpa -n "$NS" -w
```

> Se o HPA já existir, `kubectl autoscale` informa que o recurso já existe.
> Para voltar ao manifesto: `kubectl apply -f k8s/hpa.yaml`.

---

## 14. Gerar carga dentro do cluster com BusyBox

```bash
kubectl create deployment load-test -n "$NS" \
  --image=busybox:1.36 \
  --replicas=3 \
  -- /bin/sh -c "while true; do wget -q -O- http://loja-api:3000/health >/dev/null; done"
```

Acompanhar:

```bash
kubectl get pods -n "$NS" -l app=load-test
kubectl logs -n "$NS" deployment/load-test --tail=5
```

> O HPA depende de métricas reais. Se as réplicas não aumentarem, verifique:
> metrics-server funcionando, consumo de CPU acima do alvo e tempo de
> coleta (o HPA pode levar dezenas de segundos para reagir). Aumente o número
> de pods de carga ou o tempo de execução se necessário. Não presuma o
> resultado: registre o que o seu cluster mostrar.

---

## 15. Mostrar o HPA aumentando e diminuindo as réplicas

```bash
kubectl get hpa -n "$NS" -w
kubectl get pods -n "$NS" -w
kubectl get deployment loja-api -n "$NS"
```

Para remover a carga e observar a diminuição:

```bash
kubectl delete deployment load-test -n "$NS"
kubectl get hpa -n "$NS" -w
```

> Por padrão, o HPA espera cerca de 5 minutos (`--horizontal-pod-autoscaler-downscale-stabilization`)
> antes de reduzir. Para uma demonstração mais rápida, configure
> `behavior.scaleDown.stabilizationWindowSeconds` no manifesto do HPA.
> Registre os valores e tempos reais observados.

---

## 16. Consultar `kubectl top pods`

```bash
kubectl top pods -n "$NS"
kubectl top pods -n "$NS" --containers
```

> Requer metrics-server instalado e pods em execução há tempo suficiente para
> gerar métricas.

---

## 17. Consultar `kubectl describe node`

```bash
kubectl get nodes
kubectl describe node <NOME_DO_NO>
kubectl top node
```

Observe no `describe node` as seções **Capacity**, **Allocatable**,
**Allocated resources** e **Events**.

---

## 18. Provar que os dados do MySQL continuam após apagar o pod

Primeiro, consulte os produtos diretamente no MySQL:

```bash
kubectl get pods -n "$NS" -l app=mysql
kubectl exec -n "$NS" deploy/mysql -- sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT * FROM products;"'
```

Alternativa pela API (limpe o cache do Redis antes para forçar a leitura do
banco):

```bash
kubectl exec -n "$NS" deploy/redis -- redis-cli DEL products:all
kubectl port-forward -n "$NS" svc/loja-api 3000:3000
# em outro terminal:
curl http://localhost:3000/products
```

Apague o pod do MySQL (o Deployment recria outro pod):

```bash
kubectl delete pod -l app=mysql -n "$NS"
kubectl rollout status deployment/mysql -n "$NS"
kubectl get pods -n "$NS" -l app=mysql
kubectl get pvc -n "$NS"
```

Consulte novamente, sem recriar tabela nem inserir dados:

```bash
kubectl exec -n "$NS" deploy/mysql -- sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT * FROM products;"'
```

Se os dois produtos continuarem aparecendo, o volume persistente manteve os
dados. Registre as saídas antes e depois para o relatório.

---

## Diagnóstico rápido de problemas

| Sintoma | Causa provável | Verificação / solução |
|---|---|---|
| `namespaces "..." not found` | Namespace ainda não criado | `kubectl apply -f k8s/namespace.yaml` |
| Pods da API em `ImagePullBackOff` | Imagem não está no nó ou tag errada | Carregue a imagem (`kind load`, `minikube image load`, etc.) |
| PVC em `Pending` | Sem StorageClass padrão | `kubectl get storageclass` e instale um provisionador |
| API em `CrashLoopBackOff` | MySQL/Redis inacessíveis ou configuração errada | `kubectl logs -n "$NS" deploy/loja-api` |
| `/health` retorna 503 | MySQL ou Redis indisponível | `kubectl get pods -n "$NS"` e logs dos serviços |
| HPA sem métricas | metrics-server ausente ou com erro de TLS | `kubectl get apiservice v1beta1.metrics.k8s.io` |
| NodePort inacessível | Cluster sem exposição do NodePort no host | Use `kubectl port-forward` |
