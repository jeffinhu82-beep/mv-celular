# Colocar no ar (VPS + Cloudflare)

O desenho: um VPS no Brasil roda a loja com Docker Compose. A internet chega ao servidor só pela Cloudflare, através de um túnel que sai do próprio servidor (o container `cloudflared` do compose). O VPS não tem nenhuma porta aberta além do SSH. Não existe painel: deploy, backup e restauração são três scripts em `scripts/`.

```
cliente ──HTTPS──> Cloudflare ──túnel──> cloudflared ──> web (nginx) ──> api ──> postgres
```

Contas e pagamentos são feitos por você ou pelo cliente. Nenhuma senha ou chave vai para o repositório.

## 0. O que precisa existir

| Item | Onde | Custo |
| --- | --- | --- |
| Domínio (`.com.br`) | registro.br | cerca de R$ 40/ano |
| Cloudflare (DNS, túnel, proteção) | cloudflare.com, plano Free | R$ 0. O Zero Trust pode pedir um meio de pagamento mesmo no Free |
| VPS Ubuntu 24.04 em São Paulo | o provedor que vocês escolherem | 2 GB de RAM com swap dá conta. 4 GB se for pôr outros projetos |
| Repositório no GitHub (branch `sistema-novo` do `mv-celular`) | github.com | R$ 0 |
| Bucket para backup | Cloudflare R2 ou Backblaze B2 | R$ 0 até 10 GB nos dois. O R2 pode pedir cartão |
| Aviso de backup e de site fora do ar (opcional) | healthchecks.io e UptimeRobot | R$ 0 |

## 1. Domínio na Cloudflare

1. Compre o domínio no registro.br.
2. Na Cloudflare: Add a site → domínio → plano Free.
3. No registro.br, troque os servidores DNS pelos dois que a Cloudflare mostrar. A propagação leva de minutos a algumas horas.
4. Em SSL/TLS: modo **Full**. Em Edge Certificates: **Always Use HTTPS** ligado e **Minimum TLS 1.2**.

## 2. Firewall antes de tudo

No firewall do provedor (no painel dele, fora do servidor), libere **só a porta 22 (SSH)** de entrada. O túnel não precisa de nenhuma outra: ele sai do servidor para a Cloudflare.

## 3. Preparar o servidor

Do seu Mac, mande sua chave e entre:

```sh
ssh-copy-id root@IP_DO_VPS
ssh root@IP_DO_VPS
```

No servidor:

```sh
apt update && apt full-upgrade -y
apt install -y unattended-upgrades fail2ban ufw git rclone
dpkg-reconfigure -plow unattended-upgrades

adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/10-hardening.conf
systemctl restart ssh
```

Antes de fechar essa janela, abra outro terminal e confirme que `ssh deploy@IP_DO_VPS` entra. Se não entrar, desfaça pelo terminal que ainda está aberto.

Daqui em diante, tudo como `deploy`:

```sh
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Saia e entre de novo no SSH para o grupo `docker` valer. Como nenhum container publica porta, o Docker não abre nada por baixo do `ufw`.

Do seu Mac, confira que só o SSH responde:

```sh
nc -zv -w 3 IP_DO_VPS 22 80 443 5432
```

Só a 22 pode dar `succeeded`.

## 4. Túnel da Cloudflare

1. Cloudflare → Zero Trust → Networks → **Connectors** (em telas antigas, Tunnels) → Create a tunnel → **Cloudflared** → nome `loja`.
2. Copie o token (o texto longo depois de `--token` no comando de instalação). **Não rode** o comando mostrado: o túnel roda dentro do compose.
3. No túnel → **Published application routes** (em telas antigas, Public Hostname) → Add: subdomínio `loja` (ou o domínio puro), tipo **HTTP**, URL `web:80`. A Cloudflare cria o DNS sozinha.

Se o Zero Trust exigir cartão e vocês não quiserem cadastrar, dá para criar o túnel pela linha de comando (`cloudflared tunnel login`). Muda um pouco o compose: me chame antes.

## 5. Código no servidor

O sistema novo mora no branch `sistema-novo` do repositório `mv-celular`. O `main` continua sendo o sistema antigo, publicado pelo GitHub Pages: não mande o sistema novo para o `main` antes da virada.

Enquanto o repositório for público, o servidor clona sem chave:

```sh
git clone -b sistema-novo https://github.com/jeffinhu82-beep/mv-celular.git ~/loja
cd ~/loja
```

Se um dia ele virar privado, troque por uma chave só para o servidor ler o repositório:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/github_loja -N ''
cat ~/.ssh/github_loja.pub
```

No GitHub: repositório → Settings → Deploy keys → Add deploy key, cole a chave, **sem** marcar "Allow write access". Depois:

```sh
printf 'Host github.com\n  IdentityFile ~/.ssh/github_loja\n  IdentitiesOnly yes\n' >> ~/.ssh/config
cd ~/loja
git remote set-url origin git@github.com:jeffinhu82-beep/mv-celular.git
```

## 6. Variáveis

```sh
cp .env.prod.example .env
chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^SECRET_ENCRYPTION_KEY=.*/SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
nano .env
```

Preencha, sem aspas:

| Variável | Valor |
| --- | --- |
| `CLOUDFLARE_TUNNEL_TOKEN` | o token do passo 4 |
| `STORE_NAME` | `MV Celular` |
| `ADMIN_NAME` | nome do dono |
| `ADMIN_EMAIL` | e-mail do dono |
| `ADMIN_PASSWORD` | senha provisória com 8 caracteres ou mais |

`BACKUP_REMOTE` e `BACKUP_PING_URL` ficam para o passo 8; até lá, o deploy avisa que atualiza sem backup antes. `COMPOSE_FILE` já vem preenchido: ele faz o `docker compose` dessa pasta usar o compose de produção, então `docker compose logs -f api` funciona sem `-f`.

Guarde o `.env` inteiro num gerenciador de senhas (`cat .env`). O mais importante é a `SECRET_ENCRYPTION_KEY`: ela cifra as senhas de aparelho das OS, e um backup restaurado sem ela não abre esses campos.

## 7. Primeiro deploy

```sh
./scripts/prod-deploy.sh
docker compose logs api | grep "Loja criada"
```

O primeiro build leva alguns minutos. Depois:

1. Abra `https://loja.dominio.com.br`, entre com o e-mail e a senha provisória e troque a senha.
2. Tire a senha provisória do servidor:

   ```sh
   sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' .env
   docker compose up -d
   ```

3. Em Configurações → Loja, preencha CNPJ, endereço, WhatsApp, chave Pix e logo. Em Equipe, crie os usuários.

A API aplica as migrations e roda `prisma/bootstrap.ts` a cada início. O bootstrap só cria algo com o banco sem usuários e `ADMIN_EMAIL` definido. Não entram produtos de exemplo nem os usuários `.test` do seed.

## 8. Backup (antes de ter dado real)

1. Crie um bucket **privado** no R2 ou no B2 e uma chave de acesso restrita a ele. No B2, ligue "Default Encryption" no bucket (o R2 já cifra tudo).
2. Cadastre o bucket no rclone com o nome `backup`. Comece a linha com um espaço para a chave não ficar no histórico do terminal.

   R2 (o ID da conta aparece na página do R2):

   ```sh
    rclone config create backup s3 provider=Cloudflare access_key_id=CHAVE secret_access_key=SEGREDO endpoint=https://ID_DA_CONTA.r2.cloudflarestorage.com no_check_bucket=true
   ```

   B2:

   ```sh
    rclone config create backup b2 account=KEY_ID key=APPLICATION_KEY
   ```

3. No `.env`: `BACKUP_REMOTE=backup:NOME_DO_BUCKET`.
4. Rode um backup e confira o que chegou:

   ```sh
   ./scripts/prod-backup.sh
   rclone ls backup:NOME_DO_BUCKET
   ```

5. Agende para todo dia às 03:00 de São Paulo. Rode `crontab -e` e acrescente:

   ```
   0 6 * * * cd $HOME/loja && ./scripts/prod-backup.sh >> $HOME/backup.log 2>&1
   ```

   O `0 6` vale para servidor em UTC, o padrão. Se `date` mostrar `-03`, troque por `0 3`.

6. Opcional, mas recomendado: crie um check diário grátis no healthchecks.io e ponha a URL de ping em `BACKUP_PING_URL`. Se um dia o backup não rodar ou falhar, chega um e-mail.
7. **Teste a volta enquanto não há dado real.** Troque o nome da loja em Configurações e rode:

   ```sh
   ./scripts/prod-restore.sh latest
   ```

   Digite `RESTAURAR`. O nome antigo tem que voltar. Se voltou, o backup serve.

O que cada backup leva: o banco inteiro (`db/loja-AAAA-MM-DD_HHMMSS.dump`) e as fotos (`uploads/`). Dumps com mais de 30 dias são apagados, mas só depois de um backup novo chegar. Fotos nunca são apagadas do bucket.

O que a restauração faz, nesta ordem:
1. Baixa o dump e confere se ele abre.
2. Faz um backup do estado atual (`-pre-restore`).
3. Carrega o dump num banco separado, com o sistema ainda no ar.
4. Para a API por alguns segundos para trocar os bancos.
5. Devolve as fotos.

O banco de antes fica no servidor como `loja_previous` até a próxima restauração. Se algo falhar antes da troca, o banco atual não muda.

O `latest` pega o backup mais novo, menos os `-pre-restore`: assim, repetir uma restauração que falhou não traz de volta o estado que se queria desfazer. Para desfazer uma restauração, passe o nome do arquivo `-pre-restore`.

## 9. Avisos

- UptimeRobot ou Better Stack (grátis): monitore `https://loja.dominio.com.br/api/health` a cada 5 minutos, com alerta por e-mail ou Telegram.
- healthchecks.io: o passo 8.6.
- Na Cloudflare (opcional): Security → WAF → Rate limiting rule no caminho `/api/auth/login`, por exemplo 10 requisições em 10 s por IP. A API já limita sozinha, e essa regra corta o excesso antes de chegar ao servidor.

## 10. Rotina

- **Atualizar o sistema:** `git push` no branch `sistema-novo` e, do seu Mac:

  ```sh
  ssh deploy@IP_DO_VPS 'cd loja && ./scripts/prod-deploy.sh'
  ```

  O script faz, nesta ordem:
  1. Puxa o código.
  2. Faz um backup (`-pre-deploy`).
  3. Baixa as atualizações do Postgres 18 e do `cloudflared`.
  4. Reconstrói o que mudou e espera tudo ficar saudável. As migrations rodam sozinhas.
  5. Limpa as imagens velhas.

  Faça fora do horário da loja: a troca leva alguns segundos.
- **Uma vez por mês:**
  - `sudo apt update && sudo apt full-upgrade -y` (as correções de segurança já entram sozinhas);
  - `tail $HOME/backup.log`;
  - `df -h`.
- **Voltar um backup:** `./scripts/prod-restore.sh` lista os backups; `./scripts/prod-restore.sh <arquivo>` restaura um específico.

## Servidor novo (o VPS morreu ou vai trocar de provedor)

1. Faça os passos 2, 3 e 5 no servidor novo.
2. No passo 6, use o `.env` guardado no gerenciador de senhas. A `SECRET_ENCRYPTION_KEY` e o token do túnel têm que ser os mesmos. Deixe `ADMIN_EMAIL` e `ADMIN_PASSWORD` vazios: os usuários vêm do backup. Com o e-mail preenchido e sem senha, a API não sobe num banco vazio.
3. Refaça o `rclone config create` do passo 8.
4. Rode:

   ```sh
   ./scripts/prod-deploy.sh
   ./scripts/prod-restore.sh latest
   ```

5. Refaça o `crontab -e` do passo 8.5. Sem ele, o servidor novo fica sem backup diário.
6. Desligue o servidor antigo, se ele ainda estiver de pé. Com o mesmo token, os dois atenderiam o site ao mesmo tempo.

## Outros projetos no mesmo VPS

Cada projeto fica na sua pasta (`~/outro-projeto`), com o seu compose, o seu `name:`, sem `ports` e com o seu próprio serviço `cloudflared` e o seu túnel. Nada é compartilhado entre projetos, então o `api` de um não enxerga o de outro. O limite passa a ser a memória do VPS.

## Problemas comuns

| Sintoma | Onde olhar |
| --- | --- |
| Erro 1033 da Cloudflare, site não abre | `docker compose logs cloudflared` (token errado ou túnel apagado) |
| 502 Bad Gateway | `docker compose logs api` (migration falhou, variável faltando) |
| `required variable ... is missing` | Variável vazia ou faltando no `.env` |
| Build morre com `Killed` ou código 137 | Falta memória: confira o swap com `free -h` |
| Backup falhou | `tail $HOME/backup.log`; `rclone lsf backup:NOME_DO_BUCKET/db` testa a chave |
| Disco cheio | `docker system df`; `docker builder prune` |
