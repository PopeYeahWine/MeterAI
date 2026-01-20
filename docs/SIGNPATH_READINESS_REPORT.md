# SignPath Foundation Readiness Audit Report

**Repository:** PopeYeahWine/MeterAI
**Audit Date:** 2026-01-20
**Current Version:** 1.2.0
**License:** GPL-3.0-or-later
**Auditor:** Claude Code

---

## Résumé Exécutif

| Statut Global | **NOT READY** |
|---------------|---------------|
| Blocages Majeurs | 2 |
| Points Mineurs | 4 |

Le repository contient des **affirmations trompeuses** concernant la signature du code. L'application affiche "Signed by SignPath Foundation" dans l'interface utilisateur alors qu'aucune signature n'est implémentée. Ces affirmations doivent être supprimées avant toute soumission à SignPath Foundation.

---

## Checklist SignPath Foundation Conditions

### A. Licence & Conformité

| Critère | Statut | Détails |
|---------|--------|---------|
| Fichier LICENSE présent | ✅ OK | GPL-3.0-or-later complet (665 lignes) |
| Cohérence README | ✅ OK | Badge + section license conformes |
| package.json license | ✅ OK | `"license": "GPL-3.0-or-later"` |
| Cargo.toml license | ✅ OK | `license = "GPL-3.0-or-later"` |
| CODE_SIGNING_POLICY.md | ✅ OK | Présent (créé 2026-01-18) |
| PRIVACY.md | ✅ OK | Présent, 52 lignes |
| SECURITY.md | ✅ OK | Présent, 74 lignes |
| Aucune fausse affirmation de signature | ❌ **KO** | Voir section "Blocages Majeurs" |

### B. Exigences SignPath Foundation

| Critère | Statut | Détails |
|---------|--------|---------|
| Section "Code signing policy" accessible depuis README | ✅ OK | Lien vers CODE_SIGNING_POLICY.md ligne 234 |
| Phrase exigée présente | ✅ OK | "Free code signing provided by SignPath.io, certificate by SignPath Foundation" |
| Rôles de signature documentés | ⚠️ Partiel | Mentionnés mais pas liés aux groupes GitHub |
| MFA pour maintainers | ⚠️ Non vérifiable | Recommandation à documenter |

### C. Sécurité / Réputation

| Critère | Statut | Détails |
|---------|--------|---------|
| SECURITY.md (politique vulnérabilités) | ✅ OK | Contact + délais documentés |
| GitHub Actions : pas de secrets exposés | ✅ OK | Seul GITHUB_TOKEN utilisé |
| GitHub Actions : permissions minimales | ✅ OK | Permissions par défaut |
| Dependabot configuré | ❌ KO | Non configuré |
| CodeQL / scanning sécurité | ❌ KO | Non configuré |
| Lockfiles présents | ✅ OK | package-lock.json + Cargo.lock |
| Releases : provenance claire | ✅ OK | Tag → CI → Artifact |
| Pas de comportement PUA | ✅ OK | Voir analyse réseau ci-dessous |

### D. Build Windows & Packaging

| Critère | Statut | Détails |
|---------|--------|---------|
| Build .exe/.msi identifié | ✅ OK | Tauri + NSIS/MSI via release.yml |
| Point de signature identifié | ✅ OK | Après packaging, avant publication |
| Binaires proviennent de CI | ✅ OK | GitHub Actions (pas de build local) |
| Certificate thumbprint configuré | ❌ KO | `null` dans tauri.conf.json:72 |
| Timestamp URL configuré | ❌ KO | Vide dans tauri.conf.json:74 |

---

## Blocages Majeurs (P0)

### 1. ❌ Fausse affirmation "Signed by SignPath Foundation" dans l'UI

**Fichier:** `src/App.tsx`
**Lignes:** 2527-2533

```tsx
<p className="about-license-text about-license-publisher">
  Published by <strong>HPSC SAS</strong> · © 2026<br/>
  <span className="signpath-badge">
    <svg>...</svg>
    Signed by SignPath Foundation
  </span>
</p>
```

**Problème:** L'application affiche un badge bouclier avec "Signed by SignPath Foundation" alors que :
- `certificateThumbprint` est `null` dans tauri.conf.json
- Aucune étape de signature dans release.yml
- Les binaires sont effectivement non signés

**Impact:** Affirmation trompeuse aux utilisateurs finaux. Risque de rejet par SignPath Foundation pour manque d'intégrité.

---

### 2. ❌ Contradiction dans la documentation

**Fichier:** `README.md`
**Lignes:** 96-97

```markdown
> You may see a Windows SmartScreen warning when running the installer.
> This is normal for unsigned applications...
```

**Versus ligne 234:**
```markdown
Free code signing provided by SignPath.io, certificate by SignPath Foundation.
```

**Problème:** Le README affirme simultanément que l'app est non signée ET qu'elle utilise SignPath. Contradiction directe.

---

## Points Mineurs (P1/P2)

### P1-1. Documentation SignPath prématurée

**Fichiers affectés:**
- `SECURITY.md` ligne 63: "Official releases are signed using certificates provided by SignPath Foundation"
- `CONTRIBUTING.md` ligne 63: "Official releases are signed via SignPath Foundation"
- `CODE_SIGNING_POLICY.md` ligne 3: Affirme la signature sans nuance

**Action:** Reformuler pour indiquer que la signature est "en cours d'intégration" ou "prévue".

---

### P1-2. Absence de Dependabot

**Fichier manquant:** `.github/dependabot.yml`

**Impact:** Pas de surveillance automatique des vulnérabilités dans les dépendances.

---

### P1-3. Absence de CodeQL

**Fichier manquant:** `.github/workflows/codeql.yml`

**Impact:** Pas d'analyse statique de sécurité du code.

---

### P2-1. Rôles SignPath non liés aux groupes GitHub

**Fichier:** `CODE_SIGNING_POLICY.md`

**Actuel:** Mentionne "Committers", "Reviewers", "Approvers" sans lien vers des groupes GitHub.

**Action:** Ajouter liens vers les équipes GitHub ou clarifier le processus.

---

## Analyse Réseau & Comportement (Non-PUA)

L'application effectue les appels réseau suivants (documentés dans PRIVACY.md et vérifiés dans le code) :

| Endpoint | Objectif | Données envoyées |
|----------|----------|------------------|
| api.anthropic.com | Vérification usage Claude | Token API utilisateur (opt-in) |
| api.openai.com | Vérification usage OpenAI | Token API utilisateur (opt-in) |
| api.github.com | Check mise à jour | Aucune donnée sensible |

**Verdict:** Pas de comportement PUA. Pas de télémétrie cachée. Toutes les connexions sont opt-in et documentées.

---

## Configuration Actuelle (Références)

### tauri.conf.json (lignes 71-75)
```json
"windows": {
  "certificateThumbprint": null,
  "digestAlgorithm": "sha256",
  "timestampUrl": ""
}
```

### release.yml - Étapes actuelles
```yaml
# Ligne 47-73: Build avec tauri-action
- uses: tauri-apps/tauri-action@v0
  # Aucune configuration de signature
```

---

## Liste d'Actions Proposées

### P0 - Blocages (à faire AVANT soumission SignPath)

| # | Action | Fichier(s) | Effort |
|---|--------|------------|--------|
| P0-1 | Supprimer "Signed by SignPath Foundation" de l'UI | src/App.tsx:2527-2533 | 5 min |
| P0-2 | Supprimer le badge bouclier signpath-badge | src/App.tsx + src/styles.css | 5 min |
| P0-3 | Corriger la contradiction README (unsigned vs signed) | README.md:96-97 et 234 | 10 min |
| P0-4 | Reformuler SECURITY.md pour retirer l'affirmation de signature | SECURITY.md:63 | 5 min |
| P0-5 | Reformuler CONTRIBUTING.md | CONTRIBUTING.md:63 | 5 min |
| P0-6 | Reformuler CODE_SIGNING_POLICY.md (signature "prévue") | CODE_SIGNING_POLICY.md | 10 min |

### P1 - Améliorations importantes

| # | Action | Fichier(s) | Effort |
|---|--------|------------|--------|
| P1-1 | Ajouter configuration Dependabot | .github/dependabot.yml | 10 min |
| P1-2 | Ajouter workflow CodeQL | .github/workflows/codeql.yml | 15 min |
| P1-3 | Documenter les rôles avec liens GitHub | CODE_SIGNING_POLICY.md | 10 min |

### P2 - Nice to have

| # | Action | Fichier(s) | Effort |
|---|--------|------------|--------|
| P2-1 | Ajouter génération SBOM dans CI | release.yml | 30 min |
| P2-2 | Ajouter instructions vérification signature (pour après) | README.md | 15 min |

---

## Prochaines Étapes

1. **PHASE 2** : Appliquer les corrections P0 (docs uniquement, pas de code)
2. **PHASE 3** : Corriger l'UI App.tsx (supprimer fausses affirmations)
3. **PHASE 4** : Préparer l'intégration CI SignPath (workflow prêt mais désactivé)
4. **SOUMISSION** : Soumettre à SignPath Foundation avec repo propre
5. **ACTIVATION** : Après approbation, activer la signature dans CI

---

## Conclusion

Le repository MeterAI a une bonne base (licence correcte, documentation présente, CI fonctionnelle) mais contient des **affirmations prématurées** sur la signature du code qui doivent être corrigées avant toute soumission à SignPath Foundation.

**Estimation effort total P0:** ~40 minutes
**Estimation effort total P0+P1:** ~1h30

---

*Rapport généré le 2026-01-20 par Claude Code*
