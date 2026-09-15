# Ativação: Netlify + Supabase

Frontend: https://radar-leaks-devzinh.netlify.app

Banco: https://drqwqguxosedpeabwjhg.supabase.co

## 1. Criar tabelas e funções no Supabase

No projeto Supabase, abra **SQL Editor → New query**. Copie conteúdo completo de `supabase/migrations/20260915022051_radar_backend.sql` e execute uma vez.

Esse SQL cria quatro tabelas com RLS, índices, fila com bloqueio e funções acessíveis somente por `service_role`. Não concede acesso a `anon` ou `authenticated`. Não usa `SECURITY DEFINER`. Mantenha Data API habilitada; não precisa habilitar exposição automática de tabelas.

Verificação no SQL Editor:

```sql
select public.radar_dashboard();

select relname, relrowsecurity
from pg_class
where oid in ('public.radar_jobs'::regclass, 'public.radar_findings'::regclass,
              'public.radar_state'::regclass, 'public.radar_limits'::regclass);

select has_table_privilege('anon', 'public.radar_findings', 'SELECT') as anonymous_access,
       has_function_privilege('authenticated', 'public.radar_dashboard()', 'EXECUTE') as user_access;
```

Esperado: dashboard vazio, quatro `relrowsecurity=true`, acessos `false`. Código não converte dados de um MongoDB existente; migração cria banco novo. Não exclua banco antigo se houver dados a preservar.

## 2. Variáveis no Netlify

Abra projeto → **Project configuration → Environment variables**. Configure para contexto **Production** e escopo **Functions** (ou todos os escopos, se plano não oferecer seleção). Nunca use prefixo `VITE_` em segredos. Não coloque segredos em `netlify.toml`.

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | `https://drqwqguxosedpeabwjhg.supabase.co` |
| `SUPABASE_SECRET_KEY` | Nova chave `sb_secret_...`, em Supabase → Settings → API Keys |
| `APP_ORIGIN` | `https://radar-leaks-devzinh.netlify.app` (sem barra final) |
| `GITHUB_APP_ID` | App ID |
| `GITHUB_INSTALLATION_ID` | Installation ID |
| `GITHUB_PRIVATE_KEY` | Conteúdo completo do arquivo `.pem`, incluindo BEGIN/END e quebras de linha |
| `GITHUB_WEBHOOK_SECRET` | Mesmo segredo configurado na GitHub App, mínimo 32 caracteres |
| `ADMIN_PASSWORD_HASH` | Hash gerado pelo comando abaixo |
| `SESSION_SECRET` | Segredo aleatório próprio |
| `FINGERPRINT_SECRET` | Outro segredo aleatório; mantenha estável para deduplicação |
| `WORKER_SECRET` | Outro segredo aleatório para chamadas internas ao worker |

`GITHUB_PRIVATE_KEY_PATH` é alternativa para execução local. No Netlify, use `GITHUB_PRIVATE_KEY`; não envie arquivo `.pem` ao repositório. Adaptadores Netlify fixam modo de produção; `RADAR_DEMO` não ativa simulações no site publicado.

Gere cada segredo independentemente:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para definir senha administrativa, na pasta `backend`:

```powershell
node scripts/hash-password.js "SUA-SENHA-LONGA"
```

Cole somente hash em `ADMIN_PASSWORD_HASH`. Comando com senha pode permanecer no histórico do terminal. Nunca compartilhe senha, hash, chave secreta ou chave privada no chat. Se uma chave foi compartilhada, revogue e gere outra antes de configurar produção.

## 3. Publicar

Netlify lê `netlify.toml`:

- Build: `npm run build`.
- Publish: `frontend/dist`.
- Functions: `netlify/functions`.
- Node: 22.

Após definir variáveis, faça novo deploy. Confira três funções: `api`, `scan-background`, `recover-scans`. A última roda a cada minuto somente em deploy publicado. Funções em segundo plano precisam estar disponíveis no plano contratado; confirme limites e consumo no painel. Não há contratação automática por este projeto.

Abra `/api/health`. `configured:true` comprova presença/formato das variáveis, não validade das credenciais nem conexão ao banco. Faça login no site: carregar dashboard vazio comprova leitura autenticada no Supabase. Nunca chame painel vazio de monitoramento validado sem teste do webhook.

## 4. Ativar GitHub App

Webhook URL:

```text
https://radar-leaks-devzinh.netlify.app/api/webhooks/github
```

Permissão Contents: Read-only; evento Push; instalação nos repositórios públicos selecionados. Marque Active e mantenha verificação TLS habilitada. Confirme segredo igual ao do backend.

Faça um push com string sintética que corresponda a uma regra, nunca credencial real. Confira entrega 202, job concluído no banco e achado redigido no painel. O reconhecimento de um token é heurístico; nenhuma chamada testa validade da credencial no provedor.

## Operação e limites

- Webhook salva commits antes de disparar worker. Se disparo falhar, fila permanece e agendamento tenta novamente.
- Bloqueio no banco permite uma varredura ativa. Lease expira em 15 minutos; worker antigo não pode concluir após perder lease.
- Cinco tentativas com espera exponencial. Erros e contagens de varreduras parciais aparecem no dashboard.
- Worker para de iniciar novos jobs após dois minutos, reservando tempo para último commit dentro do limite de 15 minutos. Limite de 2.000 achados por commit marca varredura como parcial.
- Apenas linhas adicionadas em patches disponíveis. Sem histórico retroativo, arquivos binários ou garantia de cobertura para webhooks omitidos/truncados por GitHub.
- Painel carrega últimos 200 achados e atualiza a cada dez segundos. Filtros e gráfico atuam nessa janela.
- Sessão administrativa assinada dura oito horas. Logout limpa cookie; rotação de `SESSION_SECRET` invalida todas as sessões emitidas.
- Rate limiting usa banco compartilhado. Chaves dos limites usam HMAC do IP, sem armazenar IP em texto claro.
- Metadados de repositório, caminho e commit são persistidos. Código-fonte e tokens integrais não são.
- Schema/SQL deve ser aplicado antes de ativar webhook. Credencial Supabase secreta não executa migrations; isso exige SQL Editor ou acesso administrativo ao banco.

Para reprocessar jobs com falha depois de corrigir integração, no SQL Editor:

```sql
update public.radar_jobs
set state = 'queued', attempts = 0, available_at = now(), lease_until = null, claim_id = null, error = null
where state = 'failed';
```

Rollback de aplicação: mantenha webhook desativado e restaure deploy anterior. Não apague tabelas; preserve dados para diagnóstico ou retomada. Migração não altera tabelas preexistentes fora do prefixo `radar_`.
