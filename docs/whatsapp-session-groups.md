# Groupes WhatsApp de session

## Configuration Meta

Créer et faire approuver dans WhatsApp Manager un modèle de catégorie utilitaire, en français, avec quatre variables de corps : prénom de l’étudiant, formation, nom de la session et lien du groupe. Le texte du modèle doit identifier New Vision Academy, expliquer que l’étudiant est inscrit à cette session et l’inviter à rejoindre le groupe officiel. L’application ne remplace pas l’approbation Meta.

Configurer côté serveur, sans exposer ces valeurs au navigateur :

- `WHATSAPP_SESSION_INVITE_TEMPLATE` : nom exact du modèle approuvé (requis pour l’envoi).
- `WHATSAPP_SESSION_INVITE_LANGUAGE` : langue du modèle; défaut `fr`.
- `WHATSAPP_SESSION_INVITES_AUTOMATIC` : défaut `false`. Mettre `true` pour déclencher la tentative après création/réactivation d’une inscription.
- Les paramètres WhatsApp Cloud API existants restent requis (`WHATSAPP_ENABLED`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` et le jeton d’accès côté serveur).

L’automatisation prépare une entrée dans la file d’invitations après l’inscription; le worker WhatsApp existant la traite uniquement si `WHATSAPP_SESSION_INVITES_AUTOMATIC=true`, `WHATSAPP_ENABLED=true` et `WHATSAPP_WORKERS_ENABLED=true`. Les envois administratifs confirmés utilisent aussi ce worker, même si l’automatisation des futures inscriptions reste désactivée. Elle n’envoie qu’aux étudiants dont la préférence WhatsApp active et le consentement explicite sont déjà enregistrés. Sans consentement, numéro exploitable ou modèle configuré, l’application garde un résultat visible dans l’administration et ne tente pas d’envoi. Le flux respecte les statuts d’inscription existants; il ne change aucun paiement.

## Enregistrer et envoyer

1. Créer le groupe depuis WhatsApp Business sur le téléphone et copier son lien d’invitation.
2. Dans NVA, ouvrir **Administration → Sessions**, choisir la session exacte (l’identifiant de session et la formation sont affichés), puis ouvrir sa page.
3. Dans **Groupe WhatsApp de la session**, saisir le nom, coller le lien `https://chat.whatsapp.com/...` et enregistrer l’association active.
4. Vérifier la liste des inscriptions affichée sous cette session, les noms, numéros, statuts de paiement et consentements. La liste est filtrée par `trainingSessionId` exact, jamais par texte du nom.
5. Cocher les étudiants éligibles et confirmer le nombre dans la boîte de confirmation. La demande est placée dans la file; le worker traite les numéros un à un et la table montre les statuts `PENDING`, `PROCESSING`, `ACCEPTED`, `DELIVERED`, `FAILED` ou `UNCERTAIN`. Seuls les refus temporaires confirmés (429) sont réessayés, avec un délai et un maximum de trois tentatives. Les soumissions incertaines ne sont pas relancées.

Pour les étudiants de novembre 2026, repérer la session par sa formation et ses dates dans l’index des sessions, puis vérifier la date exacte et la liste complète sur sa page. Le nombre indicatif de 11 n’est pas codé en dur : l’administrateur confirme les inscriptions et le nombre à inviter avant l’envoi. Si la session ou la formation est ambiguë, ne pas envoyer depuis une session choisie au hasard.

## Migration et limites

La migration `20261122120000_add_whatsapp_session_groups` crée uniquement les nouvelles tables et types, avec clés étrangères et unicité par session/inscription. L’historique `whatsapp_session_invitation_attempts` conserve le statut, le résultat et l’identifiant provider de chaque tentative, sans recopier les numéros. La migration doit être relue et appliquée par la procédure de déploiement habituelle, après sauvegarde; elle n’est pas appliquée par les tests.

La Cloud API permet de transmettre le lien à un numéro individuel et de corréler les états du message. Elle ne confirme pas qu’un étudiant a rejoint le groupe, ne lit pas les conversations du groupe et n’en gère pas les membres. Le statut `JOINED` reste inutilisé tant qu’aucune preuve réelle d’adhésion n’est disponible.
