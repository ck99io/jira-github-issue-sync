jira-github-issue-sync
======================

Syncs jira's stories/sprints to github's milestones/issues.

### Install

```
npm install -g stephanieerin/sync-jira-github
```

### Run

You need to create a _json_ file with github and jira confiurations. Then you can run:

```
sync-jira-github project.json
```

You have an example at [project-example.json](https://github.com/weareswat/jira-github-issue-sync/blob/master/project-example.json).


### Implementation Notes

1. The repo that's listed in the project.json file will be used **if** there isn't a label on the task. You should configure JIRA to automatically assign labels or to require them.
2. You need to have milestones created in Github for the sprint you're working with. Currently, it will create a milestone on the default repo but NOT on any additional repositories. You can manually add them in the client and the issues will be created appropriately.


### Current Limitations

- Would we rather: have a static list of possible repos and check/create milestones according to the current active sprint OR manually add sprints to each repo when you create a new sprint. Considering there are only a handful of repos (this could be put in the project.json file) that we work with, adding each repo will probably come up a lot less than every sprint.

Current Repos:
ozp-rest
center-ui
hud
ozp-rest-jmeter
ozp-docs


- Another thing to look at is our user mapping. Currently when you assign an issue in JIRA it will look for the right user to assign it to based on user mapping in the project.json file. We have to make sure everyone on the team a) has a github user name and b) that each subtask is assigned before we add them (or we can set up a default assignee in github or something).


### Developer To Dos:

- --Fix broken transition functionality (close a Jira issue when a github issue is closed)--
- - Nice to have: include commit notes in a comment with close?
- --Add repo list to project.json and functionality to gather ALL github tickets from ALL repos at the beginning (to avoid recreating the same issues in github over and over)--
- Add sync await to avoid nested things, forcing synchronous behavior in an async application
- Update assignee in GitHub if Jira assignee changes

### Authentication

GitHub Account:
username: ozp-jira-github
password: Pa22word
email: stephanie.schneider@nextcentury.com

* You only need the email address to reset the password on this account *