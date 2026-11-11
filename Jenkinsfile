pipeline {
    agent { label 'youtube-lab' }
    tools { nodejs 'node24' }
    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 60, unit: 'MINUTES')
    }
    triggers { pollSCM('H/5 * * * *') }
    parameters {
        string(name: 'DOCKERHUB_NAMESPACE', defaultValue: 'koenchill', description: 'Your Docker Hub namespace')
        choice(name: 'API_MODE', choices: ['demo', 'live'], description: 'Demo uses synthetic metadata. Live needs a provider subscription and key.')
        booleanParam(name: 'ENFORCE_AUDIT', defaultValue: false, description: 'Learning default records npm vulnerabilities. Enable to fail on high or critical findings before release.')
    }
    environment { SCANNER_HOME = tool 'sonar-scanner' }
    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm
                script {
                    if (!(params.DOCKERHUB_NAMESPACE ==~ /[a-z0-9][a-z0-9_-]{2,29}/)) {
                        error('Set a valid Docker Hub namespace')
                    }
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()}"
                    env.WEB_TAG = "${params.DOCKERHUB_NAMESPACE}/youtube-web:${env.IMAGE_TAG}"
                    env.PROXY_TAG = "${params.DOCKERHUB_NAMESPACE}/youtube-proxy:${env.IMAGE_TAG}"
                }
                sh '''#!/usr/bin/env bash
set -euo pipefail
! git ls-files | grep -E '(^|/)[.]env($|[.])' | grep -Ev '(^|/)[.]env[.]example$'
! grep -R -n -E 'REACT_APP_RAPID_API_KEY|X-RapidAPI-Key' src
node --version
npm --version
docker version --format '{{.Server.Version}}'
'''
            }
        }
        stage('Install and test') {
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail
npm ci --no-audit --no-fund
CI=true npm test -- --watchAll=false --runInBand --coverage --collectCoverageFrom='src/**/*.{js,jsx}'
node --test --experimental-test-coverage proxy/server.test.mjs
'''
            }
        }
        stage('Dependency audit') {
            steps {
                script {
                    int status = sh(script: 'npm audit --json > npm-audit.json', returnStatus: true)
                    sh 'node scripts/check-audit.mjs'
                    if (status != 0) {
                        echo 'Dependency findings recorded in npm-audit.json. Review before release.'
                    }
                    if (params.ENFORCE_AUDIT) {
                        sh 'npm audit --audit-level=high'
                    }
                }
            }
        }
        stage('Production build') {
            steps { sh 'CI=true GENERATE_SOURCEMAP=false npm run build' }
        }
        stage('SonarQube analysis') {
            steps {
                withSonarQubeEnv('sonar-local') {
                    sh '"$SCANNER_HOME/bin/sonar-scanner"'
                }
                sh 'test -s .scannerwork/report-task.txt'
            }
        }
        stage('Quality gate') {
            steps {
                timeout(time: 15, unit: 'MINUTES') {
                    script {
                        def gate = waitForQualityGate(webhookSecretId: 'sonar-webhook-secret')
                        if (gate.status != 'OK') { error("Quality gate failed: ${gate.status}") }
                    }
                }
            }
        }
        stage('Build container images') {
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail
docker build --pull --label "org.opencontainers.image.revision=$GIT_COMMIT" -t "$WEB_TAG" .
docker build --pull --label "org.opencontainers.image.revision=$GIT_COMMIT" -f Dockerfile.proxy -t "$PROXY_TAG" .
'''
            }
        }
        stage('Publish and deploy') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_TOKEN')]) {
                    script {
                        env.DOCKER_CONFIG = "${pwd(tmp: true)}/docker-auth"
                        sh '''#!/usr/bin/env bash
set -euo pipefail
set +x
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"
printf '%s' "$REGISTRY_TOKEN" | docker login -u "$REGISTRY_USER" --password-stdin
docker push "$WEB_TAG"
docker push "$PROXY_TAG"
'''
                        env.WEB_IMAGE = sh(script: 'docker image inspect --format \'{{index .RepoDigests 0}}\' "$WEB_TAG"', returnStdout: true).trim()
                        env.PROXY_IMAGE = sh(script: 'docker image inspect --format \'{{index .RepoDigests 0}}\' "$PROXY_TAG"', returnStdout: true).trim()
                        withEnv(["API_MODE=${params.API_MODE}"]) {
                            if (params.API_MODE == 'live') {
                                withCredentials([string(credentialsId: 'rapidapi-key', variable: 'RAPIDAPI_KEY')]) {
                                    sh 'bash scripts/deploy.sh'
                                }
                            } else { sh 'bash scripts/deploy.sh' }
                        }
                    }
                }
            }
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'npm-audit.json,coverage/lcov.info', allowEmptyArchive: true
            sh '''#!/usr/bin/env bash
set +x
if [ -n "${DOCKER_CONFIG:-}" ] && [ -d "$DOCKER_CONFIG" ]; then
  docker logout >/dev/null 2>&1 || true
  rm -f "$DOCKER_CONFIG/config.json"
fi
'''
        }
        success { echo 'Application release passed the configured gate and deployment checks.' }
        failure { echo 'Release stopped. Read the first failed stage before restarting services.' }
    }
}
