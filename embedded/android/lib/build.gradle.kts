/*
 * Copyright 2026 Belgian Secure Communications (BSC)
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 *
 * Modified by Belgian Secure Communications for Beam application on 2026-04-30
 */

// PG_CHANGED

import org.gradle.api.credentials.HttpHeaderCredentials
import org.gradle.authentication.http.HttpHeaderAuthentication
import java.util.Properties

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.maven.publish)
}

repositories {
    mavenCentral()
    google()
}

val localProperties = Properties()
val localPropertiesFile = project.rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localProperties.load(localPropertiesFile.inputStream())
}

android {
    namespace = "io.element.android"

    defaultConfig {
        compileSdk = 35
        minSdk = 24
    }
}

mavenPublishing {
    val version = System.getenv("EC_VERSION") ?: "1.0.0"
    coordinates("be.pg", "pg-call-embedded", version)
    pom {
        name = "Embedded Element Call for Android"
        description.set("Android AAR package containing an embedded build of the Element Call widget.")
        inceptionYear.set("2025")
        url.set("https://github.com/element-hq/element-call/")
        licenses {
            license {
                name.set("GNU Affero General Public License (AGPL) version 3.0")
                url.set("https://www.gnu.org/licenses/agpl-3.0.txt")
                distribution.set("https://www.gnu.org/licenses/agpl-3.0.txt")
            }
            license {
                name.set("Element Commercial License")
                url.set("https://raw.githubusercontent.com/element-hq/element-call/refs/heads/livekit/LICENSE-COMMERCIAL")
                distribution.set("https://raw.githubusercontent.com/element-hq/element-call/refs/heads/livekit/LICENSE-COMMERCIAL")
            }
        }
        developers {
            developer {
                id.set("matrixdev")
                name.set("matrixdev")
                url.set("https://github.com/element-hq/")
                email.set("android@element.io")
            }
        }
        scm {
            url.set("https://github.com/element-hq/element-call/")
            connection.set("scm:git:git://github.com/element-hq/element-call.git")
            developerConnection.set("scm:git:ssh://git@github.com/element-hq/element-call.git")
        }
    }
}

publishing {
    repositories {
        // GitLab Package Registry
        val gitlabUrl = localProperties.getProperty("gitlabUrl")
        val gitlabProjectId = localProperties.getProperty("gitlabProjectId")
        val gitlabToken = localProperties.getProperty("gitlabToken")

        val missing = listOfNotNull(
            if (gitlabUrl.isNullOrEmpty()) "gitlabUrl" else null,
            if (gitlabProjectId.isNullOrEmpty()) "gitlabProjectId" else null,
            if (gitlabToken.isNullOrEmpty()) "gitlabToken" else null,
        )
        if (missing.isNotEmpty()) {
            error("Missing required properties in local.properties: ${missing.joinToString()}")
        }

        maven {
            name = "GitLab"
            url = uri("$gitlabUrl/api/v4/projects/$gitlabProjectId/packages/maven")
            credentials(HttpHeaderCredentials::class) {
                name = "Private-Token"
                value = gitlabToken
            }
            authentication {
                create<HttpHeaderAuthentication>("header")
            }
        }
    }
}
