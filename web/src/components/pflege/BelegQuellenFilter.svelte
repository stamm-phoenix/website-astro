<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { BELEG_QUELLEN, type BelegEintrag, type BelegQuelle } from '../../lib/belegEintraege';

  interface Props {
    entries: BelegEintrag[];
    websiteLoaded: boolean;
    campflowLoaded: boolean;
    value: BelegQuelle | '';
    onselect: (value: BelegQuelle | '') => void;
  }
  let { entries, websiteLoaded, campflowLoaded, value, onselect }: Props = $props();
</script>

<FilterTabs
  label="Belege auswählen"
  options={[
    { value: '', label: 'Alle', count: websiteLoaded ? entries.length : undefined },
    ...BELEG_QUELLEN.map((option) => ({
      value: option.value,
      label: option.label,
      count: (option.value === 'campflow' ? campflowLoaded : websiteLoaded)
        ? entries.filter((entry) => entry.quelle === option.value).length
        : undefined,
    })),
  ]}
  {value}
  {onselect}
  countNouns={['Beleg', 'Belege']}
/>
