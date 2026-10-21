/** Famiglia, inviti e lista condivisa. */
import type * as T from '../api';
import { check, sb } from './client';
import { nowIso } from './common';
import { familyOut, moveMyThings, myProfile, setDisplayName } from './data';

export const familyApi = {
  familyCreate: async (_user_id: string, display_name: string): Promise<T.Family> => {
    await setDisplayName(display_name);
    const fam = check(await sb().rpc('create_family')) as any;
    await moveMyThings(fam.id);
    return (await familyOut()) as T.Family;
  },

  familyJoin: async (_user_id: string, display_name: string, code: string): Promise<T.Family> => {
    await setDisplayName(display_name);
    // il codice famiglia fisso non vale più (#13): si entra solo con un invito
    const r = check(await sb().rpc('join_with_invite', { c: code, p_name: display_name || null })) as T.JoinResult;
    if (r.status === 'invalid') throw new Error(r.reason || 'Invito non valido');
    if (r.status === 'pending') throw new Error('Richiesta inviata: aspetta che un familiare ti accetti');
    if (r.group_id) await moveMyThings(r.group_id);
    return (await familyOut()) as T.Family;
  },

  familyLeave: async (_user_id: string) => {
    await moveMyThings(null);
    check(await sb().rpc('leave_family'));
    return { ok: true };
  },

  familyByUser: async (_userId: string) => familyOut(),

  // ------------------------------------------------ inviti e approvazioni (#13)
  inviteCreate: async (group: string) => {
    const r = check(await sb().rpc('create_invite', { g: group })) as any;
    return { code: r.code as string, expires_at: r.expires_at as string };
  },
  invitesOpen: async (group: string) => (check(await sb().rpc('group_open_invites', { g: group })) ?? []) as T.OpenInvite[],
  inviteRevoke: async (code: string) => { check(await sb().rpc('revoke_invite', { c: code })); },
  invitePreview: async (code: string) => check(await sb().rpc('invite_preview', { c: code })) as T.InvitePreview,
  inviteJoin: async (code: string, name?: string) => {
    const r = check(await sb().rpc('join_with_invite', { c: code, p_name: name?.trim() || null })) as T.JoinResult;
    if (r.status === 'joined' && r.kind === 'famiglia' && r.group_id) await moveMyThings(r.group_id).catch(() => {});
    return r;
  },
  inviteRejoin: async (code: string, old: string) => check(await sb().rpc('rejoin_as', { c: code, old })) as T.JoinResult,
  joinRequests: async (group: string) => (check(await sb().rpc('group_pending_requests', { g: group })) ?? []) as T.JoinRequest[],
  joinDecide: async (group: string, user: string, accept: boolean) => {
    check(await sb().rpc('decide_join_request', { g: group, u: user, accept }));
  },
  myJoinRequest: async () => {
    const rows = check(await sb().rpc('my_join_request')) as T.MyJoinRequest[] | null;
    return rows?.[0] ?? null;
  },
  memberRemove: async (group: string, user: string) => { check(await sb().rpc('remove_member', { g: group, u: user })); },

  familyPushList: async (code: string, _user_id: string, items: T.ListItem[]): Promise<T.FamilyList> => {
    const p = await myProfile();
    if (!p.family_id) throw new Error('Non fai parte di questa famiglia');
    const doc = { family_id: p.family_id, items, updated_by: p.id, updated_at: nowIso() };
    check(await sb().from('family_lists').upsert(doc));
    return { code, items, updated_by: p.id, updated_at: doc.updated_at };
  },

  familyPullList: async (code: string): Promise<T.FamilyList> => {
    const p = await myProfile();
    if (!p.family_id) return { code, items: [] };
    const row = check(await sb().from('family_lists').select('*').eq('family_id', p.family_id).maybeSingle()) as any;
    return row ? { code, items: row.items, updated_by: row.updated_by, updated_at: row.updated_at } : { code, items: [] };
  },
};
