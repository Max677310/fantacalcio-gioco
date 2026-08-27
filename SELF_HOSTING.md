# 🚀 Self-Hosting Guide — Fantacalcio Manager

Guida completa per fare il deploy **gratuito** dell'app fuori dalla piattaforma
Emergent, usando servizi cloud con piano gratis. Tempo stimato: **1-2 ore** per
la prima volta.

---

## 📋 Architettura finale

```
┌──────────────┐        ┌────────────────┐        ┌───────────────────┐
│  Utenti Web  │───────▶│    Vercel      │───────▶│    Render         │
│ (browser)    │        │ (Expo Web)     │  HTTPS │ (FastAPI backend) │
└──────────────┘        └────────────────┘        │                   │
                                                  │                   │
┌──────────────┐        ┌────────────────┐        │                   │
│ Amici Mobile │───────▶│   Expo Go +    │───────▶│                   │
│ (iOS/Android)│        │  EAS Update    │  HTTPS │                   │
└──────────────┘        └────────────────┘        └─────────┬─────────┘
                                                            │
                                                            ▼
                                                  ┌───────────────────┐
                                                  │ MongoDB Atlas M0  │
                                                  │  (Free forever)   │
                                                  └───────────────────┘
```

**Costo totale mensile**: **0 €** (con limiti dei piani gratuiti).

---

## 🎯 Cosa ottieni gratis e cosa NO

| Componente | Free tier | Limiti | Alternativa a pagamento |
|---|---|---|---|
| **MongoDB Atlas M0** | ✅ Gratis per sempre | 512 MB storage, 100 connessioni | M10 ~57$/mo |
| **Render Web Service** | ✅ Gratis | Cold-start 30s dopo 15 min inattività, 750h/mese | Starter 7$/mo (no sleep) |
| **Vercel Hobby** | ✅ Gratis | 100 GB bandwidth/mese, no uso commerciale | Pro 20$/mo |
| **Resend Free** | ✅ Gratis | 100 email/giorno, 3.000/mese | Pro 20$/mo |
| **Expo Go** | ✅ Gratis | Solo per test/dev, non pubblicabile su Store | EAS Build gratis 30/mese |
| **iOS App Store** | ❌ **99$/anno** | — | (obbligatorio Apple) |
| **Google Play Store** | 25$ una tantum | — | (obbligatorio Google) |

⚠️ **Cold-start Render**: se nessuno usa l'app per 15 minuti, il primo utente
successivo aspetterà 20-30 secondi per il "risveglio". Sopportabile per 10-50
amici. Se ti dà fastidio, upgrade a **Render Starter (7$/mo)** o passa a
**Fly.io** (più complesso da configurare ma senza cold start su piano free).

---

## 📥 STEP 0 — Scarica il codice da Emergent

1. Nell'editor Emergent, cerca il pulsante **Download code** in alto a destra
   (potrebbe essere sotto Publish o nel menu ⋮).
2. Ricevi uno ZIP con `/backend` e `/frontend`.
3. Estrai in una cartella locale, es. `~/projects/fantacalcio/`.
4. Inizializza git e pusha su un nuovo repo GitHub privato:
   ```bash
   cd ~/projects/fantacalcio
   git init
   git add .
   git commit -m "chore: initial import from Emergent"
   gh repo create fantacalcio --private --source=. --push
   # o manualmente su github.com e poi:
   # git remote add origin git@github.com:tuoutente/fantacalcio.git
   # git push -u origin main
   ```

Se **non trovi il pulsante Download code**, scrivi a `support@emergent.sh` con
il Job ID (lo trovi in URL della preview): chiedi un export ZIP del progetto.

---

## 🗄️ STEP 1 — MongoDB Atlas (Database)

1. Vai su **[cloud.mongodb.com](https://cloud.mongodb.com)** e crea un account
   (usa email + password, no carta di credito).
2. **Build a Database** → seleziona **M0 (Free)** → Provider AWS, Region
   `eu-west-1 (Ireland)` (più vicino all'Italia).
3. Attendi 2-3 minuti la provisioning.
4. **Database Access** → Add Database User → username `fanta`, password
   auto-generata (salvala).
5. **Network Access** → Add IP Address → **Allow access from anywhere**
   `0.0.0.0/0` (per semplicità; in produzione restringi agli IP di Render).
6. **Connect** → **Drivers** → **Python** → copia la connection string:
   ```
   mongodb+srv://fanta:<PASSWORD>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Sostituisci `<PASSWORD>` con quella salvata. Salvala nel Password Manager.

---

## 📧 STEP 2 — Resend (Invio email password reset)

1. Vai su **[resend.com](https://resend.com)** e registrati.
2. **Domains** → Add Domain → inserisci un dominio che possiedi (es.
   `fantacalcio.tuo-dominio.it`).
   - Se **non hai un dominio**, per test puoi usare il subdominio gratuito
     `onboarding@resend.dev` (limitato a inviare solo al tuo account) o
     acquistare un dominio economico su Namecheap/Cloudflare (~10€/anno).
3. Aggiungi i **record DNS** (SPF, DKIM, DMARC) che Resend ti mostra alla
   configurazione del tuo dominio. Aspetta 5-30 minuti per la verifica.
4. **API Keys** → Create API Key → nome `fantacalcio-prod`, permesso
   **Sending access**. Copia la key `re_xxxxxxxxxx` e salvala.

---

## 🖥️ STEP 3 — Deploy Backend su Render

1. Vai su **[render.com](https://render.com)** → login con GitHub.
2. **New +** → **Blueprint** → collega il repo GitHub del punto 0.
3. Render legge il file **`render.yaml`** già presente in root e propone il
   servizio `fantacalcio-backend`. Clicca **Apply**.
4. Nella pagina Environment del servizio, imposta:

   | Chiave | Valore |
   |---|---|
   | `MONGO_URL` | connection string di Atlas (Step 1) |
   | `DB_NAME` | `fantacalcio` (già default) |
   | `RESEND_API_KEY` | `re_xxxxxxxxxx` (Step 2) |
   | `EMAIL_FROM` | `Fantacalcio <noreply@tuodominio.it>` |
   | `EMAIL_FROM_NAME` | `Fantacalcio Manager` (già default) |
   | `EMAIL_REPLY_TO` | *(opzionale)* la tua email |
   | `APP_PUBLIC_URL` | URL Vercel (lo saprai dopo Step 4) |

5. **Manual Deploy** → **Deploy latest commit**. Segui i log — la prima build
   dura ~4 minuti.
6. Al termine ricevi un URL tipo `https://fantacalcio-backend.onrender.com`.
   Verifica con:
   ```bash
   curl https://fantacalcio-backend.onrender.com/api/
   # → {"message":"Fantacalcio API","status":"ok"}
   ```

### 🐳 Alternativa: usa il Dockerfile

Se preferisci il container invece che il buildpack Python, in Render:
- Runtime: **Docker**
- Dockerfile path: `backend/Dockerfile`

Funziona identico ma è più portabile (puoi spostarlo su Fly.io, Railway, Cloud
Run senza modifiche).

---

## 🌐 STEP 4 — Deploy Frontend Web su Vercel

1. Vai su **[vercel.com](https://vercel.com)** → login con GitHub.
2. **Add New → Project** → seleziona lo stesso repo.
3. Vercel rileva il **`vercel.json`** in `/frontend`. Imposta:
   - **Root directory**: `frontend`
   - **Build command**: `npx expo export --platform web --output-dir dist`
     (già in vercel.json)
   - **Output directory**: `dist`
   - **Framework preset**: *Other*
4. **Environment Variables**:

   | Chiave | Valore |
   |---|---|
   | `EXPO_PUBLIC_BACKEND_URL` | URL Render (Step 3), es. `https://fantacalcio-backend.onrender.com` |

5. **Deploy**. Prima build ~3 minuti.
6. Ricevi un URL tipo `https://fantacalcio.vercel.app`. Aprendo il link vedi
   la versione web dell'app.
7. Ora torna su Render → Settings → aggiorna `APP_PUBLIC_URL` con l'URL Vercel
   e rilancia il deploy backend.

---

## 📱 STEP 5 — App Mobile via Expo Go (Free)

Con Expo Go i tuoi amici possono usare l'app **senza pubblicare sugli store**.

### Opzione A — Tunnel locale (PC deve essere acceso)
```bash
cd frontend
npx expo start --tunnel
```
QR code condivisibile finché il tuo PC resta acceso. Non è la soluzione ideale
per il "sempre attivo".

### Opzione B — EAS Update (raccomandata, gratis)
1. Crea account gratuito su **[expo.dev](https://expo.dev)**.
2. Nel PC installa la CLI: `npm install -g eas-cli`.
3. Dentro `/frontend`:
   ```bash
   eas login
   eas update:configure
   ```
4. Modifica `frontend/app.json` aggiungendo il tuo `slug` e `updates.url`:
   ```json
   {
     "expo": {
       "name": "Fantacalcio",
       "slug": "fantacalcio",
       "owner": "TUO_USERNAME_EXPO",
       "runtimeVersion": { "policy": "sdkVersion" },
       "updates": {
         "url": "https://u.expo.dev/PROJECT_ID"
       }
     }
   }
   ```
5. Pubblica un aggiornamento:
   ```bash
   eas update --branch production --message "Deploy iniziale"
   ```
6. Condividi con gli amici questo link:
   ```
   exp://u.expo.dev/PROJECT_ID?channel-name=production
   ```
   Devono installare **Expo Go** dallo store e aprire il link.

**Non serve il tuo PC**: il pacchetto JS è servito dalla CDN di Expo, gratis
fino a 1.000 utenti mensili.

---

## 📦 STEP 6 (Opzionale) — Build native per App Store / Play Store

Solo se vuoi pubblicare l'app "vera" fuori da Expo Go.

### Android APK (gratis)
```bash
cd frontend
eas build --platform android --profile preview
```
Ricevi un `.apk` scaricabile che gli amici possono installare direttamente.
30 build gratis al mese.

### iOS Simulator (gratis, solo Mac)
```bash
eas build --platform ios --profile development
```

### Pubblicazione Store (a pagamento)
- **Google Play**: 25$ una tantum, poi `eas submit --platform android`
- **Apple App Store**: 99$/anno Apple Developer, poi `eas submit --platform ios`

Aggiorna prima `frontend/eas.json` con il tuo `appleId`, `ascAppId`,
`appleTeamId` per iOS.

---

## 🔄 STEP 7 — Aggiornamenti futuri

Dopo modifiche al codice:

```bash
git add . && git commit -m "feat: nuova funzionalità"
git push origin main
```

- **Backend**: Render fa auto-deploy ad ogni push su `main` (grazie a
  `autoDeploy: true` in render.yaml).
- **Frontend Web**: Vercel fa auto-deploy identico.
- **App Mobile**: esegui `eas update --branch production` per pushare il
  nuovo bundle JS. Gli utenti riceveranno l'update alla prossima apertura
  dell'app (over-the-air, senza reinstall).

---

## 🛡️ STEP 8 — Sicurezza produzione

- ✅ `JWT_SECRET` auto-generato da Render (già configurato in render.yaml)
- ✅ CORS aperto (`*`) — restringi a `https://fantacalcio.vercel.app` in
  produzione modificando la linea `allow_origins` in `backend/server.py`
- ✅ Non committare `.env` (già in `.gitignore`)
- ⚠️ Passa MongoDB Atlas da `0.0.0.0/0` alla whitelist degli IP di Render
  (vedi [render docs](https://render.com/docs/static-outbound-ip-addresses))
- ⚠️ Attiva **backup automatico** su Atlas (M10 e superiori)

---

## ⚡ Troubleshooting

### "Application failed to start" su Render
- Controlla i log: `sudo supervisorctl` non esiste in Render. Usa
  `Logs` nel dashboard.
- Verifica che `MONGO_URL` sia corretta e che l'utente Atlas abbia permessi
  `readWrite` sul database `fantacalcio`.

### "Cold start" fastidioso
- Setup un cron esterno (es. [cron-job.org](https://cron-job.org) gratis) che
  chiama `https://fantacalcio-backend.onrender.com/api/` ogni 10 minuti per
  tenere sveglia l'istanza.
- ⚠️ Consuma le 750 ore/mese di piano free, ma in un mese sono 720h — ok
  giusto giusto.

### Email non arrivano
- Verifica su [resend.com](https://resend.com) → Emails che lo status sia
  `delivered`. Se `undeliverable`, il dominio non è stato verificato.
- Per test iniziali usa `to: "delivered@resend.dev"` (sempre delivered).

### Il frontend web dice "Errore di rete"
- Controlla la variabile `EXPO_PUBLIC_BACKEND_URL` in Vercel.
- Assicurati che il backend Render risponda: `curl <url>/api/`.
- Se il backend è in cold-start, aspetta 30s e riprova.

### iOS build fallisce con "Missing profile"
- Serve un Apple Developer Account attivo (99$/anno).
- Configura in `eas.json` sotto `submit.production.ios`.

---

## 📞 Aiuto

- **Render**: dashboard → Support (chat live)
- **Vercel**: dashboard → Help
- **MongoDB Atlas**: `chat.mongodb.com`
- **Expo**: [forums.expo.dev](https://forums.expo.dev)
- **Emergent**: `support@emergent.sh` (per problemi di export/download)

Buon self-hosting! 🎉
