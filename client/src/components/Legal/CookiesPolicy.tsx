// eslint-disable i18next/no-literal-string
import React from 'react';
import { useGetStartupConfig } from '~/data-provider';

const sections = [
  {
    title: 'O Que Isso Significa',
    items: [
      'Não definimos nem lemos quaisquer cookies',
      'Não rastreamos seu comportamento de navegação',
      'Não coletamos nenhuma informação pessoal',
      'Não utilizamos cookies de análise ou publicidade',
      'Não usamos serviços de rastreamento de terceiros',
    ],
  },
  {
    title: 'Armazenamento no Navegador',
    body: 'Embora não utilizemos cookies, este site de documentação pode recorrer a recursos do navegador, como:',
    items: [
      'Local Storage: para lembrar sua preferência de tema (modo claro/escuro)',
      'Session Storage: para manter o estado da navegação durante sua visita',
    ],
  },
  {
    body: 'Esses dados:',
    items: [
      'São armazenados apenas no seu navegador',
      'Nunca são transmitidos a qualquer servidor',
      'Podem ser apagados ao limpar os dados do navegador',
      'Não identificam você pessoalmente',
    ],
  },
  {
    title: 'Links de Terceiros',
    body: 'Nossa documentação pode conter links para sites externos que podem utilizar cookies. Não somos responsáveis pelas práticas de cookies desses sites. Recomendamos que você revise as políticas de cookies ao visitá-los.',
  },
  {
    title: 'Sua Privacidade',
    body: 'Como não utilizamos cookies:',
    items: [
      'Não há nada para aceitar ou recusar',
      'Nenhum rastreamento é realizado',
      'Sua navegação é totalmente privada',
      'Nenhum banner de consentimento é necessário',
    ],
  },
  {
    title: 'Alterações Nesta Política',
    body: 'Podemos atualizar esta política de cookies para fins de clareza. Qualquer atualização será publicada nesta página com uma nova data de “Última atualização”.',
  },
  {
    body: 'Ao usar este site de documentação, você reconhece que nenhum cookie ou tecnologia de rastreamento é utilizado.',
  },
];

export default function CookiesPolicy() {
  const { data: startupConfig } = useGetStartupConfig();

  return (
    <div className="bg-surface-primary text-text-primary">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 py-10 pb-5 pt-2 sm:px-8 md:px-10">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-text-secondary">
            Política de Cookies
          </p>
          <h1 className="text-3xl font-semibold text-text-primary">Nenhum Cookie Utilizado</h1>
          <p className="text-base text-text-secondary">
            O sistema {startupConfig?.appTitle ?? 'Chat IA'} não utiliza cookies ou tecnologias
            similares de rastreamento.
          </p>
        </header>

        <div className="space-y-6 rounded-2xl border border-border-light bg-surface-secondary p-6 shadow-sm">
          {sections.map(({ title, body, items }) => (
            <section key={title} className="space-y-2">
              <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
              {body && <p className="text-base leading-relaxed text-text-secondary">{body}</p>}
              {items && (
                <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed text-text-secondary">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="rounded-xl bg-surface-tertiary px-5 py-4 text-sm text-text-secondary">
          Última atualização: 27 de janeiro de 2026
        </footer>
      </div>
    </div>
  );
}
