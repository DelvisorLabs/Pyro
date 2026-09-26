import { CliError, request } from "./transport.js";

export async function diagnose(connection: { gateway: string; control: string; timeout: number }) {
  const check = async (base: string, path: string) => {
    try {
      const result = await request(new URL(`${base}${path}`), "GET", {}, undefined, Math.min(connection.timeout, 5_000));
      return { ok: true, status: result.response.status, detail: result.data };
    } catch (error) {
      return { ok: false, status: error instanceof CliError ? error.details?.status : undefined, detail: error instanceof Error ? error.message : "Check failed" };
    }
  };
  const [gateway, control, semantic] = await Promise.all([
    check(connection.gateway, "/v1/health"), check(connection.control, "/health"), check(connection.gateway, "/v1/ready"),
  ]);
  return {
    gateway, control, semantic,
    localRulesReady: gateway.ok && control.ok,
    guidance: !gateway.ok || !control.ok
      ? "These are server checks. For standalone checks use pyro doctor --local and pyro classify --local. For server features, start Docker or set an existing instance URL: https://delvisor.com/pyro/docs#setup. Installing the CLI does not start a server."
      : !semantic.ok
        ? "Local-only profiles work without a provider key. For semantic checks, add a TypeSafe key in Settings → Classifier provider, then run pyro doctor --semantic. Readiness checks configuration, not detector accuracy or provider availability."
        : "Server checks passed. Semantic configuration is present; test your policy against representative traffic before enforcement.",
  };
}
