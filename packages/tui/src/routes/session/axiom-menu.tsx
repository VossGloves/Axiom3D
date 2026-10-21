import { useTheme } from "../../context/theme"
import { usePluginRuntime } from "../../plugin/runtime"

export function AxiomMenu(props: { sessionID: string }) {
  const { theme } = useTheme()
  const pluginRuntime = usePluginRuntime()

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={theme.text}>
        <b>Axiom Menu</b>
      </text>
      <pluginRuntime.Slot name="axiom_menu_content" session_id={props.sessionID}>
        <box marginTop={1}>
          <text fg={theme.textMuted}>No asset plan yet</text>
        </box>
      </pluginRuntime.Slot>
      <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
    </box>
  )
}
