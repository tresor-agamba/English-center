-- READ ONLY: identify actual grant sources; no passwords, bodies or role settings.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT 1/(current_database()=:'expected_database')::int AS target_confirmed;
WITH worker AS (SELECT oid FROM pg_roles WHERE rolname=:'nva_worker_role'),
objects AS (SELECT oid,relname,relowner,relacl FROM pg_class WHERE oid IN
 (to_regclass('public.whatsapp_conversation_messages'),to_regclass('public."WhatsAppAdmissionRequest"'),
  to_regclass('public."WhatsAppAdmissionEvent"'),to_regclass('public."WhatsAppAdmissionEvent_id_seq"')))
SELECT o.relname,pg_get_userbyid(o.relowner) AS owner,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable,
 a.grantee=(SELECT oid FROM worker) AS direct_worker_grant
FROM objects o CROSS JOIN LATERAL aclexplode(o.relacl) a ORDER BY o.relname,grantee,a.privilege_type;
SELECT c.relname,col.attname,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
 pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_attribute col ON col.attrelid=c.oid
CROSS JOIN LATERAL aclexplode(col.attacl) a
WHERE c.oid IN (to_regclass('public.whatsapp_conversation_messages'),to_regclass('public."WhatsAppAdmissionRequest"'),
 to_regclass('public."WhatsAppAdmissionEvent"')) AND col.attnum>0 AND NOT col.attisdropped
ORDER BY c.relname,col.attnum,grantee,a.privilege_type;
SELECT member.rolname AS member,parent.rolname AS parent,m.admin_option
FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
WHERE member.rolname=:'nva_worker_role';
-- Default grants explain future provisioning, not existing effective rights.
SELECT pg_get_userbyid(d.defaclrole) AS creator,n.nspname,d.defaclobjtype,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE a.grantee=0 OR a.grantee=(SELECT oid FROM pg_roles WHERE rolname=:'nva_worker_role');
COMMIT;
