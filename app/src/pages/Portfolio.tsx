import { useState, useEffect } from 'react';
import {
  Container,
  Title,
  Text,
  SimpleGrid,
  Card,
  Badge,
  Group,
  Modal,
  Stack,
  Anchor,
  Paper,
  Image,
  Button,
  List,
  Code,
  AspectRatio,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { Project } from '@zoci/shared';
import { projects } from '../data/projects';
import { profile, socials } from '../data/profile';
import { panelStyle } from '../theme';
import { BrandIcon } from '../components/BrandIcon';

type Block = Project['body'][number];

// True once web fonts have settled. The header title is large and uses the 700 weight;
// if Open Sans (self-hosted, font-display: swap) swaps in *during* the entrance slide,
// the title reflows mid-animation and stutters. Gating the slide on document.fonts.ready
// means it animates in already in its final font. Falls back after 800ms so it never hangs.
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(finish);
    } else {
      finish();
    }
    const t = setTimeout(finish, 800);
    return () => clearTimeout(t);
  }, []);
  return ready;
}

function ModalBlock({ b }: { b: Block }) {
  switch (b.kind) {
    case 'heading':
      return (
        <Title order={4} mt="sm">
          {b.text}
        </Title>
      );
    case 'text':
      return <Text>{b.md}</Text>;
    case 'list':
      return (
        <List size="sm" spacing={4}>
          {b.items.map((it, i) => (
            <List.Item key={i}>{it}</List.Item>
          ))}
        </List>
      );
    case 'image':
      return <Image src={b.src} alt={b.alt} radius="sm" />;
    case 'video':
      return (
        <video
          src={b.src}
          poster={b.poster}
          controls
          preload="metadata"
          style={{ width: '100%', borderRadius: 8, display: 'block' }}
        />
      );
    case 'youtube':
      return (
        <AspectRatio ratio={16 / 9}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${b.id}`}
            title={`video ${b.id}`}
            style={{ border: 0, borderRadius: 8 }}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </AspectRatio>
      );
    case 'code':
      return <Code block>{b.src}</Code>;
    default:
      return null;
  }
}

export default function Portfolio() {
  const [opened, { open, close }] = useDisclosure(false);
  const [active, setActive] = useState<Project | null>(null);
  const fontsReady = useFontsReady();

  const show = (p: Project) => {
    setActive(p);
    open();
  };

  return (
    <Container size="lg" py="lg">
      {/* Header: identity + about, on a readable panel above the background */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={fontsReady ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4 }}
      >
        <Paper radius="md" p="lg" mb="xl" style={panelStyle}>
          <Group justify="space-between" align="flex-start" mb="sm">
          <Title order={1} fz="clamp(2.25rem, 6vw, 3.25rem)" lh={1.1}>
            <Text component="span" inherit className="title-accent">
              {profile.name}
            </Text>
          </Title>
          <Anchor component={Link} to="/" size="sm" underline="never" className="home-link">
            <span className="home-arrow">←</span> home
          </Anchor>
        </Group>
        <Text c="dimmed" fw={700} mb="md">
          {profile.tagline}
        </Text>
        <Stack gap={6}>
          {profile.about.map((p, i) => (
            <Text key={i} size="sm" c="dimmed">
              {p}
            </Text>
          ))}
        </Stack>
        </Paper>
      </motion.div>

      {/* Projects */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
        {projects.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.4, delay: (i % 3) * 0.05 }}
          >
            {/* The card stays put; its CONTENTS react on hover. This wrapper is a
                Motion variant orchestrator — hovering flips it to "hover", which
                propagates to the children below (the thumbnail zooms, the title
                nudges). Pairs with the CSS glow bloom on .project-card. */}
            <motion.div
              role="button"
              aria-label={`Open ${p.title}`}
              tabIndex={0}
              style={{ cursor: 'pointer', height: '100%' }}
              initial="rest"
              animate="rest"
              whileHover="hover"
              onClick={() => show(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') show(p);
              }}
            >
              <Card radius={0} padding="lg" className="project-card gold-frame" h="100%">
                <span
                  className="frame-shimmer"
                  aria-hidden="true"
                  // diagonal wave: fire by top-left→bottom-right position (row + col, 3-col grid)
                  style={{ animationDelay: `${0.15 + (Math.floor(i / 3) + (i % 3)) * 0.1}s` }}
                />
                {p.thumbnail && (
                  // overflow-hidden frame so the image zooms WITHIN its bounds
                  <div style={{ overflow: 'hidden', borderRadius: 4 }}>
                    <motion.img
                      src={p.thumbnail}
                      alt={p.title}
                      variants={{
                        rest: { scale: 1, filter: 'brightness(1)' },
                        hover: { scale: 1.1, filter: 'brightness(1.08)' },
                      }}
                      transition={{ type: 'spring', stiffness: 210, damping: 20 }}
                      style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                )}
                <Group justify="space-between" mt="md" mb="xs">
                  <motion.span
                    variants={{ rest: { x: 0 }, hover: { x: 5 } }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                    style={{ display: 'inline-block' }}
                  >
                    <Text fw={600}>{p.title}</Text>
                  </motion.span>
                  {p.legacy && (
                    <Badge color="gray" variant="outline">
                      legacy
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {p.blurb}
                </Text>
                <Group gap={4} mt="sm">
                  {p.tags.map((t) => (
                    <Badge key={t} size="xs" variant="light">
                      {t}
                    </Badge>
                  ))}
                </Group>
              </Card>
            </motion.div>
          </motion.div>
        ))}
      </SimpleGrid>

      {/* Socials — brand icons set in an OSRS bank tab */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.4 }}
      >
        <Group gap="sm" justify="center" mt="xl">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              title={s.label}
              className="social-btn"
            >
              <BrandIcon name={s.label} />
            </a>
          ))}
        </Group>
      </motion.div>

      <Modal
        opened={opened}
        onClose={close}
        title={<span className="modal-title">{active?.title}</span>}
        size="lg"
        centered
        styles={{
          header: { borderBottom: '1px solid rgba(196, 160, 84, 0.28)', marginBottom: 4 },
          title: { flex: 1 },
        }}
      >
        <Stack>
          {active?.body.map((b, idx) => (
            <ModalBlock key={idx} b={b} />
          ))}

          {active?.links && active.links.length > 0 && (
            <Group gap="xs">
              {active.links.map((l) => (
                <Button
                  key={l.href}
                  component="a"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="light"
                  size="xs"
                >
                  {l.label}
                </Button>
              ))}
            </Group>
          )}

          {active?.note && (
            <Text size="sm" c="dimmed" fs="italic">
              Note: {active.note}
            </Text>
          )}
        </Stack>
      </Modal>
    </Container>
  );
}
