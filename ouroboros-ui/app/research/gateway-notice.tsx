import {
  GATEWAY_NOTICE_HREF,
  GATEWAY_NOTICE_LINK,
  GATEWAY_NOTICE_OFF,
  GATEWAY_NOTICE_STILL,
  GATEWAY_NOTICE_TITLE,
} from "./states";

/**
 * The gateway-absent notice (CN.7, [#633](https://github.com/NobuData/ouroboros/issues/633)) —
 * the one place the page says the deployment cannot run research.
 *
 * It sits between the head and the grid, above every region, because it is a fact about the
 * deployment rather than about any card: said here once, the cards under it do not repeat it —
 * the two start controls carry the short reason as their own, and nothing else changes. It
 * names what is off, what still works, and where model access is set up.
 *
 * `role="status"`: a standing fact about the page, not an interruption.
 *
 * @returns The notice.
 */
export function GatewayNotice() {
  return (
    <div className="research__notice" role="status">
      <p className="research__notice-title">{GATEWAY_NOTICE_TITLE}</p>
      <p className="research__notice-text">
        {GATEWAY_NOTICE_OFF} {GATEWAY_NOTICE_STILL}
      </p>
      <a className="research__notice-link" href={GATEWAY_NOTICE_HREF}>
        {GATEWAY_NOTICE_LINK}
      </a>
    </div>
  );
}
