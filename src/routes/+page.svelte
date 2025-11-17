<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    // Redirect to mentorai chat interface
    goto('/mentorai');
  });
</script>

<div style="padding: 2rem; text-align: center;">
  <p>Redirecting to MentorAI...</p>
</div>
