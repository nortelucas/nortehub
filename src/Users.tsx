import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users as UsersIcon, Calendar, FileText, TrendingUp, Network, ListChecks } from "lucide-react";

interface UsageEntry {
  ip: string;
  username: string;
  date: string;
  count: number;
}

interface UsageData {
  users: Record<string, string>;
  daily: Record<string, Record<string, number>>;
  entries: UsageEntry[];
}

interface UserSummary {
  username: string;
  ips: string[];
  total: number;
  firstSeen: string;
  lastSeen: string;
  days: { date: string; count: number }[];
}

interface UserSummaryDraft {
  username: string;
  ips: Set<string>;
  total: number;
  firstSeen: string;
  lastSeen: string;
  days: Record<string, number>;
}

function formatDate(date: string): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
}

function uniqueUserCount(entries: UsageEntry[], users: Record<string, string>): number {
  const names = new Set<string>();
  for (const username of Object.values(users)) {
    if (username) names.add(username);
  }
  for (const entry of entries) {
    if (entry.username) names.add(entry.username);
  }
  return names.size;
}

function buildEntries(data: UsageData): UsageEntry[] {
  if (data.entries.length > 0) {
    return data.entries
      .map((entry) => ({
        ip: entry.ip || "unknown",
        username: entry.username || "SemNome",
        date: entry.date || "",
        count: Number(entry.count) || 0,
      }))
      .sort((a, b) => {
        const dateOrder = b.date.localeCompare(a.date);
        if (dateOrder !== 0) return dateOrder;
        return a.username.localeCompare(b.username);
      });
  }

  const usernameToIps = Object.entries(data.users).reduce<Record<string, string[]>>((acc, [ip, username]) => {
    if (!acc[username]) acc[username] = [];
    acc[username].push(ip);
    return acc;
  }, {});

  return Object.entries(data.daily)
    .flatMap(([date, daily]) =>
      Object.entries(daily).map(([username, count]) => ({
        ip: usernameToIps[username]?.join(", ") || "unknown",
        username,
        date,
        count: Number(count) || 0,
      }))
    )
    .sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date);
      if (dateOrder !== 0) return dateOrder;
      return a.username.localeCompare(b.username);
    });
}

function buildUserSummaries(entries: UsageEntry[], users: Record<string, string>): UserSummary[] {
  const summaryMap: Record<string, UserSummaryDraft> = {};

  for (const [ip, username] of Object.entries(users) as Array<[string, string]>) {
    const name = username || "SemNome";
    if (!summaryMap[name]) {
      summaryMap[name] = { username: name, ips: new Set(), total: 0, firstSeen: "", lastSeen: "", days: {} };
    }
    if (ip) summaryMap[name].ips.add(ip);
  }

  for (const entry of entries) {
    const username = entry.username || "SemNome";
    if (!summaryMap[username]) {
      summaryMap[username] = { username, ips: new Set(), total: 0, firstSeen: "", lastSeen: "", days: {} };
    }

    if (entry.ip) {
      for (const ip of entry.ip.split(",").map((value) => value.trim()).filter(Boolean)) {
        summaryMap[username].ips.add(ip);
      }
    }

    summaryMap[username].total += entry.count;
    summaryMap[username].days[entry.date] = (summaryMap[username].days[entry.date] || 0) + entry.count;

    if (!summaryMap[username].lastSeen || entry.date > summaryMap[username].lastSeen) {
      summaryMap[username].lastSeen = entry.date;
    }
    if (!summaryMap[username].firstSeen || entry.date < summaryMap[username].firstSeen) {
      summaryMap[username].firstSeen = entry.date;
    }
  }

  return Object.values(summaryMap)
    .map((user) => ({
      username: user.username,
      ips: Array.from(user.ips).sort(),
      total: user.total,
      firstSeen: user.firstSeen,
      lastSeen: user.lastSeen,
      days: Object.entries(user.days)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));
}

export function Users() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setData({
          users: payload.users || {},
          daily: payload.daily || {},
          entries: Array.isArray(payload.entries) ? payload.entries : [],
        });
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Carregando...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-red-400 text-sm">Erro ao carregar dados: {error}</div>
      </div>
    );
  }

  const entries = buildEntries(data);
  const users = buildUserSummaries(entries, data.users);
  const totalUses = entries.reduce((sum, entry) => sum + entry.count, 0);
  const totalUsers = uniqueUserCount(entries, data.users);
  const totalIps = new Set(entries.flatMap((entry) => entry.ip.split(",").map((ip) => ip.trim()).filter(Boolean))).size;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayUses = entries
    .filter((entry) => entry.date === todayStr)
    .reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50">
      <div className="bg-white/80 backdrop-blur shadow-sm ring-1 ring-slate-900/5 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
          <UsersIcon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-slate-900">Painel de Usuários</h1>
          <p className="text-xs text-slate-500">Visão completa dos dados de uso por usuário</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <UsersIcon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums tracking-tight">{totalUsers}</div>
                <div className="text-xs text-slate-400">Usuários únicos</div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums tracking-tight">{totalUses}</div>
                <div className="text-xs text-slate-400">Total de usos</div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums tracking-tight">{todayUses}</div>
                <div className="text-xs text-slate-400">Usos hoje</div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-50 rounded-lg flex items-center justify-center">
                <Network className="w-5 h-5 text-sky-500" />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800 font-mono tabular-nums tracking-tight">{totalIps}</div>
                <div className="text-xs text-slate-400">IPs registrados</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {users.length === 0 ? (
          <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl">
            <CardContent className="py-16 text-center text-slate-400 text-sm">
              Nenhum uso registrado ainda.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden">
              <CardHeader className="bg-white border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <UsersIcon className="w-4 h-4" />
                  </span>
                  <CardTitle className="text-base font-bold tracking-tight text-slate-900">
                    Resumo por Usuário
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-50">
                  {users.map((user) => (
                    <div key={user.username} className="px-6 py-4 hover:bg-slate-50/70 transition-colors">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">
                              {user.username.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0 space-y-2">
                            <div>
                              <div className="font-semibold tracking-tight text-slate-900 text-sm">{user.username}</div>
                              <div className="text-xs text-slate-400">
                                Primeiro uso: {formatDate(user.firstSeen)} · Último uso: {formatDate(user.lastSeen)}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {user.ips.length > 0 ? (
                                user.ips.map((ip) => (
                                  <Badge key={`${user.username}-${ip}`} variant="outline" className="font-mono text-[11px] font-semibold bg-slate-50 text-slate-700 border-slate-200">
                                    {ip}
                                  </Badge>
                                ))
                              ) : (
                                <Badge variant="outline" className="font-mono text-[11px] font-semibold bg-slate-50 text-slate-700 border-slate-200">unknown</Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 shrink-0 lg:text-right">
                          <div>
                            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums tracking-tight">{user.total}</div>
                            <div className="text-xs text-slate-400">usos</div>
                          </div>
                          <div>
                            <div className="text-lg font-bold text-slate-800 font-mono tabular-nums tracking-tight">{user.days.length}</div>
                            <div className="text-xs text-slate-400">dias</div>
                          </div>
                        </div>
                      </div>

                      {user.days.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 lg:ml-12">
                          {user.days.map(({ date, count }) => (
                            <div key={`${user.username}-${date}`} className="flex items-center gap-1.5">
                              <Calendar className="w-3 h-3 text-slate-300" />
                              <span className="text-xs text-slate-500">{formatDate(date)}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-slate-50 text-slate-700 border-slate-200 tabular-nums">
                                {count} uso{count !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white border-none ring-1 ring-slate-900/5 shadow-lg shadow-slate-900/5 rounded-2xl overflow-hidden">
              <CardHeader className="bg-white border-b border-slate-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <ListChecks className="w-4 h-4" />
                  </span>
                  <CardTitle className="text-base font-bold tracking-tight text-slate-900">
                    Registros Detalhados
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Usuário</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">IP</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Data</TableHead>
                        <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">Usos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry, index) => (
                        <TableRow key={`${entry.username}-${entry.ip}-${entry.date}-${index}`} className="hover:bg-slate-50/70">
                          <TableCell className="font-medium text-slate-800">{entry.username}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{entry.ip}</TableCell>
                          <TableCell className="text-slate-600 tabular-nums">{formatDate(entry.date)}</TableCell>
                          <TableCell className="text-right font-semibold text-slate-800 font-mono tabular-nums">{entry.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <p className="text-center text-xs text-slate-400">
          /users - acesso restrito
        </p>
      </div>
    </div>
  );
}
