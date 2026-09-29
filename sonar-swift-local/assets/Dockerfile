# SonarQube com suporte a Swift/Objective-C.
#
# Swift não é analisável na Community Build: `/api/languages/list` não traz
# `swift`, porque as linguagens Apple são exclusivas da Developer Edition.
# Este Dockerfile preenche a lacuna com o plugin de terceiros sonar-apple.
#
# O plugin é fixado por versão E por checksum. Sem o checksum, um release
# reescrito na origem entraria em silêncio — e o plugin declara
# `Plugin-ChildFirstClassLoader: false`, ou seja, roda com o mesmo alcance de
# classes do servidor.
#
# Ajuste SONARQUBE_VERSION para a sua instância. Ao trocar PLUGIN_VERSION,
# troque também o SHA-256: pegue com `shasum -a 256 <jar>` depois de baixar.
ARG SONARQUBE_VERSION=26.9.0.129388-community
FROM sonarqube:${SONARQUBE_VERSION}

ARG PLUGIN_VERSION=0.5.1
ARG PLUGIN_SHA256=c27432e52a6ebc698b77ad42bf3d98f5e34fb20d3f398799bda74fbc008f8612

USER root
RUN set -eux; \
    url="https://github.com/insideapp-fr/sonar-apple/releases/download/${PLUGIN_VERSION}/sonar-apple-plugin-${PLUGIN_VERSION}.jar"; \
    dest="/opt/sonarqube/extensions/plugins/sonar-apple-plugin-${PLUGIN_VERSION}.jar"; \
    curl -fsSL -o "$dest" "$url"; \
    echo "${PLUGIN_SHA256}  ${dest}" | sha256sum -c -; \
    # A imagem roda como uid 1000 com gid 0 (padrão compatível com OpenShift);
    # não existe grupo "sonarqube". O diretório de plugins é 0770 de 1000:0.
    chown 1000:0 "$dest"; \
    chmod 0640 "$dest"
USER 1000
